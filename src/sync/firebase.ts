import {
  collection,
  deleteDoc as firestoreDeleteDoc,
  doc as firestoreDoc,
  getDoc as firestoreGetDoc,
  getDocFromServer,
  getDocs as firestoreGetDocs,
  getDocsFromServer,
  query as firestoreQuery,
  setDoc as firestoreSetDoc,
  where as firestoreWhere,
  writeBatch as firestoreWriteBatch,
  type Firestore,
} from 'firebase/firestore';
import { DEFAULT_DRM_PROTOCOL_PROFILE } from '../constants.js';
import {
  DrmContainerFormatError,
  KeyringSyncAuthExpiredError,
  KeyringSyncPermissionScopeError,
} from '../errors.js';
import { parseDrmKeyringBackupJson } from '../keyringCrypto.js';
import type { KeyringStore } from '../storage.js';
import type {
  DrmKeyringBackupHeader,
  DrmKeyringEncryptedBackup,
  DrmManagedKey,
  RemoteKeyringSummary,
} from '../types.js';
import type { CloudKeyringSyncProvider } from './types.js';

export const DEFAULT_FIRESTORE_KEYRING_COLLECTION = 'drmKeyrings';
export const DEFAULT_FIRESTORE_KEYS_COLLECTION = 'drmManagedKeys';

export interface FirestoreDocumentAdapter {
  getDoc(collectionPath: string, docId: string): Promise<Record<string, unknown> | null>;
  setDoc(collectionPath: string, docId: string, data: Record<string, unknown>): Promise<void>;
  deleteDoc(collectionPath: string, docId: string): Promise<void>;
  listDocsByOwner(
    collectionPath: string,
    ownerId: string
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  batchWrite?(
    operations: Array<
      | { type: 'set'; collectionPath: string; docId: string; data: Record<string, unknown> }
      | { type: 'delete'; collectionPath: string; docId: string }
    >
  ): Promise<void>;
}

export interface CreateFirebaseAdapterOptions {
  /**
   * When `true` (default), reads use `getDocFromServer` / `getDocsFromServer` with graceful
   * fallback to cached `getDoc` / `getDocs` when offline so stale multi-device keyrings are avoided.
   */
  preferServerReads?: boolean;
}

function isOfflineReadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code ?? '').toLowerCase() : '';
  const message =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    code === 'unavailable' ||
    code.endsWith('/unavailable') ||
    message.includes('offline') ||
    message.includes('client is offline')
  );
}

/**
 * Wraps a modular Firebase Web SDK `Firestore` instance into a `FirestoreDocumentAdapter`.
 */
export function createFirebaseFirestoreAdapter(
  db: Firestore,
  options: CreateFirebaseAdapterOptions = {}
): FirestoreDocumentAdapter {
  const preferServerReads = options.preferServerReads ?? true;

  return {
    async getDoc(collectionPath: string, docId: string): Promise<Record<string, unknown> | null> {
      const ref = firestoreDoc(db, collectionPath, docId);
      let snap;
      if (preferServerReads) {
        try {
          snap = await getDocFromServer(ref);
        } catch (err) {
          if (!isOfflineReadError(err)) throw err;
          snap = await firestoreGetDoc(ref);
        }
      } else {
        snap = await firestoreGetDoc(ref);
      }
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    },

    async setDoc(
      collectionPath: string,
      docId: string,
      data: Record<string, unknown>
    ): Promise<void> {
      const ref = firestoreDoc(db, collectionPath, docId);
      await firestoreSetDoc(ref, data);
    },

    async deleteDoc(collectionPath: string, docId: string): Promise<void> {
      const ref = firestoreDoc(db, collectionPath, docId);
      await firestoreDeleteDoc(ref);
    },

    async listDocsByOwner(
      collectionPath: string,
      ownerId: string
    ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
      const q = firestoreQuery(
        collection(db, collectionPath),
        firestoreWhere('ownerId', '==', ownerId)
      );
      let snap;
      if (preferServerReads) {
        try {
          snap = await getDocsFromServer(q);
        } catch (err) {
          if (!isOfflineReadError(err)) throw err;
          snap = await firestoreGetDocs(q);
        }
      } else {
        snap = await firestoreGetDocs(q);
      }
      return snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
    },

    async batchWrite(operations): Promise<void> {
      if (operations.length === 0) return;
      const chunkSize = 450;
      for (let i = 0; i < operations.length; i += chunkSize) {
        const chunk = operations.slice(i, i + chunkSize);
        const batch = firestoreWriteBatch(db);
        for (const op of chunk) {
          const ref = firestoreDoc(db, op.collectionPath, op.docId);
          if (op.type === 'set') {
            batch.set(ref, op.data);
          } else {
            batch.delete(ref);
          }
        }
        await batch.commit();
      }
    },
  };
}

export function classifyFirebaseKeyringError(
  err: unknown,
  contextMessage = 'Firebase Firestore keyring operation failed'
): Error {
  if (
    err instanceof KeyringSyncAuthExpiredError ||
    err instanceof KeyringSyncPermissionScopeError ||
    err instanceof DrmContainerFormatError
  ) {
    return err;
  }

  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '').toLowerCase()
      : '';
  const detail = err instanceof Error ? err.message : String(err);

  if (
    code === 'unauthenticated' ||
    code.endsWith('/unauthenticated') ||
    code.startsWith('auth/')
  ) {
    return new KeyringSyncAuthExpiredError(
      'Firebase authentication session expired. Please sign in again.'
    );
  }

  if (code === 'permission-denied' || code.endsWith('/permission-denied')) {
    return new KeyringSyncPermissionScopeError(
      'Firestore permission denied for DRM keyring access. Verify your account email and security rules.'
    );
  }

  return err instanceof Error ? err : new Error(`${contextMessage}: ${detail}`);
}

export interface FirestoreKeyringBackupDoc extends DrmKeyringEncryptedBackup {
  ownerId: string;
  sizeBytes: number;
  modifiedTime: string;
  updatedAt: number;
}

export type FirebaseKeyringSyncProviderOptions = (
  | { db: Firestore; adapter?: undefined }
  | { adapter: FirestoreDocumentAdapter; db?: undefined }
) & {
  getOwnerId: (options?: { interactive?: boolean }) => string | null | Promise<string | null>;
  collectionPath?: string;
  documentId?: string | ((ownerId: string) => string);
  preferServerReads?: boolean;
  expectedAppId?: string;
  onAuthExpired?: () => void;
  onPermissionScopeError?: () => void;
};

/**
 * Cloud Firestore `CloudKeyringSyncProvider` storing double-encrypted `DrmKeyringEncryptedBackup`
 * documents in `drmKeyrings/{uid}` (zero plaintext keys or passphrases ever leave the client).
 */
export class FirebaseKeyringSyncProvider implements CloudKeyringSyncProvider {
  private readonly adapter: FirestoreDocumentAdapter;
  private readonly getOwnerId: (options?: {
    interactive?: boolean;
  }) => string | null | Promise<string | null>;
  private readonly collectionPath: string;
  private readonly documentIdOption?: string | ((ownerId: string) => string);
  private readonly expectedAppId: string;
  private readonly onAuthExpired?: () => void;
  private readonly onPermissionScopeError?: () => void;

  constructor(options: FirebaseKeyringSyncProviderOptions) {
    if ('adapter' in options && options.adapter) {
      this.adapter = options.adapter;
    } else if ('db' in options && options.db) {
      this.adapter = createFirebaseFirestoreAdapter(options.db, {
        preferServerReads: options.preferServerReads ?? true,
      });
    } else {
      throw new Error('Provide either a Firestore `db` instance or a `FirestoreDocumentAdapter`.');
    }

    this.getOwnerId = options.getOwnerId;
    this.collectionPath = options.collectionPath ?? DEFAULT_FIRESTORE_KEYRING_COLLECTION;
    this.documentIdOption = options.documentId;
    this.expectedAppId = options.expectedAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.keyringBackupAppId;
    this.onAuthExpired = options.onAuthExpired;
    this.onPermissionScopeError = options.onPermissionScopeError;
  }

  private resolveDocId(ownerId: string): string {
    if (typeof this.documentIdOption === 'function') {
      return this.documentIdOption(ownerId);
    }
    return this.documentIdOption ?? ownerId;
  }

  private async requireOwnerId(interactive: boolean): Promise<string> {
    const raw = await this.getOwnerId({ interactive });
    const trimmed = raw?.trim();
    if (!trimmed) {
      throw new KeyringSyncAuthExpiredError(
        'Sign in with a verified account to synchronize your DRM keyring with Firestore.'
      );
    }
    return trimmed;
  }

  private handleError(err: unknown, contextMessage: string): never {
    const classified = classifyFirebaseKeyringError(err, contextMessage);
    if (classified instanceof KeyringSyncAuthExpiredError) {
      this.onAuthExpired?.();
    } else if (classified instanceof KeyringSyncPermissionScopeError) {
      this.onPermissionScopeError?.();
    }
    throw classified;
  }

  private extractBackupFromDoc(raw: Record<string, unknown>): DrmKeyringEncryptedBackup {
    const candidate: Record<string, unknown> = {
      schemaVersion: raw.schemaVersion,
      app: raw.app,
      backupId: raw.backupId,
      createdAt: raw.createdAt,
      keyCount: raw.keyCount,
      keyFingerprints: raw.keyFingerprints,
      ...(typeof raw.backupHint === 'string' && raw.backupHint ? { backupHint: raw.backupHint } : {}),
      cipher: raw.cipher,
      kdf: raw.kdf,
      iterations: raw.iterations,
      saltB64: raw.saltB64,
      ivB64: raw.ivB64,
      ciphertextB64: raw.ciphertextB64,
    };
    return parseDrmKeyringBackupJson(JSON.stringify(candidate), {
      expectedAppId: this.expectedAppId,
    });
  }

  private buildSummary(
    docId: string,
    modifiedTime: string,
    sizeBytes: number,
    backup?: DrmKeyringEncryptedBackup
  ): RemoteKeyringSummary {
    const header: DrmKeyringBackupHeader | undefined = backup
      ? {
          schemaVersion: 1,
          app: backup.app,
          backupId: backup.backupId,
          createdAt: backup.createdAt,
          keyCount: backup.keyCount,
          keyFingerprints: [...backup.keyFingerprints],
          ...(backup.backupHint ? { backupHint: backup.backupHint } : {}),
        }
      : undefined;

    return {
      fileId: `${this.collectionPath}/${docId}`,
      modifiedTime,
      sizeBytes,
      header,
    };
  }

  async inspect(options?: { interactive?: boolean }): Promise<RemoteKeyringSummary | null> {
    const ownerId = (await this.getOwnerId({ interactive: options?.interactive ?? false }))?.trim();
    if (!ownerId) return null;

    const docId = this.resolveDocId(ownerId);
    try {
      const raw = await this.adapter.getDoc(this.collectionPath, docId);
      if (!raw) return null;

      let parsed: DrmKeyringEncryptedBackup | undefined;
      try {
        parsed = this.extractBackupFromDoc(raw);
      } catch {
        parsed = undefined;
      }

      const modifiedTime =
        typeof raw.modifiedTime === 'string' && raw.modifiedTime
          ? raw.modifiedTime
          : new Date(
              typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
            ).toISOString();
      const sizeBytes =
        typeof raw.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes)
          ? raw.sizeBytes
          : new TextEncoder().encode(JSON.stringify(raw)).byteLength;

      return this.buildSummary(docId, modifiedTime, sizeBytes, parsed);
    } catch (err) {
      this.handleError(err, 'Failed to inspect Firestore DRM keyring');
    }
  }

  async pull(options?: { interactive?: boolean }): Promise<DrmKeyringEncryptedBackup | null> {
    const ownerId = await this.requireOwnerId(options?.interactive ?? true);
    const docId = this.resolveDocId(ownerId);
    try {
      const raw = await this.adapter.getDoc(this.collectionPath, docId);
      if (!raw) return null;
      return this.extractBackupFromDoc(raw);
    } catch (err) {
      this.handleError(err, 'Failed to download DRM keyring from Firestore');
    }
  }

  async push(
    backup: DrmKeyringEncryptedBackup,
    options?: { interactive?: boolean }
  ): Promise<RemoteKeyringSummary> {
    const ownerId = await this.requireOwnerId(options?.interactive ?? true);
    const docId = this.resolveDocId(ownerId);
    const now = Date.now();
    const modifiedTime = new Date(now).toISOString();
    const sizeBytes = new TextEncoder().encode(JSON.stringify(backup)).byteLength;

    const docData: FirestoreKeyringBackupDoc = {
      schemaVersion: backup.schemaVersion,
      app: backup.app,
      backupId: backup.backupId,
      createdAt: backup.createdAt,
      keyCount: backup.keyCount,
      keyFingerprints: [...backup.keyFingerprints],
      ...(backup.backupHint ? { backupHint: backup.backupHint } : {}),
      cipher: backup.cipher,
      kdf: backup.kdf,
      iterations: backup.iterations,
      saltB64: backup.saltB64,
      ivB64: backup.ivB64,
      ciphertextB64: backup.ciphertextB64,
      ownerId,
      sizeBytes,
      modifiedTime,
      updatedAt: now,
    };

    try {
      await this.adapter.setDoc(
        this.collectionPath,
        docId,
        docData as unknown as Record<string, unknown>
      );
      return this.buildSummary(docId, modifiedTime, sizeBytes, backup);
    } catch (err) {
      this.handleError(err, 'Failed to save DRM keyring to Firestore');
    }
  }

  async delete(options?: { interactive?: boolean }): Promise<void> {
    const ownerId = await this.requireOwnerId(options?.interactive ?? true);
    const docId = this.resolveDocId(ownerId);
    try {
      await this.adapter.deleteDoc(this.collectionPath, docId);
    } catch (err) {
      this.handleError(err, 'Failed to delete Firestore DRM keyring');
    }
  }
}

export type FirestoreKeyringStoreOptions = (
  | { db: Firestore; adapter?: undefined }
  | { adapter: FirestoreDocumentAdapter; db?: undefined }
) & {
  getOwnerId: () => string | null | Promise<string | null>;
  collectionPath?: string;
  preferServerReads?: boolean;
};

function sanitizeFirestoreManagedKey(raw: Record<string, unknown>): DrmManagedKey | null {
  if (
    typeof raw.keyId !== 'string' ||
    typeof raw.label !== 'string' ||
    typeof raw.fingerprint !== 'string' ||
    raw.kdf !== 'PBKDF2-SHA256' ||
    typeof raw.iterations !== 'number' ||
    typeof raw.saltB64 !== 'string' ||
    typeof raw.wrapIvB64 !== 'string' ||
    typeof raw.wrappedKeyB64 !== 'string'
  ) {
    return null;
  }

  return {
    keyId: raw.keyId,
    label: raw.label,
    fingerprint: raw.fingerprint,
    generation: typeof raw.generation === 'number' ? raw.generation : 1,
    status: raw.status === 'retired' ? 'retired' : 'active',
    isDefault: Boolean(raw.isDefault),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    ...(typeof raw.rotatedAt === 'number' ? { rotatedAt: raw.rotatedAt } : {}),
    ...(typeof raw.rotatedFromKeyId === 'string' && raw.rotatedFromKeyId
      ? { rotatedFromKeyId: raw.rotatedFromKeyId }
      : {}),
    ...(typeof raw.rotatedToKeyId === 'string' && raw.rotatedToKeyId
      ? { rotatedToKeyId: raw.rotatedToKeyId }
      : {}),
    ...(typeof raw.keyHint === 'string' && raw.keyHint ? { keyHint: raw.keyHint } : {}),
    kdf: 'PBKDF2-SHA256',
    iterations: raw.iterations,
    saltB64: raw.saltB64,
    wrapIvB64: raw.wrapIvB64,
    wrappedKeyB64: raw.wrappedKeyB64,
  };
}

/**
 * Cloud Firestore `KeyringStore` storing already-wrapped `DrmManagedKey` records scoped per `ownerId`.
 * Suitable when an app wants per-key Firestore persistence (with `firestore.drm-keyring.rules`).
 */
export class FirestoreKeyringStore implements KeyringStore {
  private readonly adapter: FirestoreDocumentAdapter;
  private readonly getOwnerId: () => string | null | Promise<string | null>;
  private readonly collectionPath: string;

  constructor(options: FirestoreKeyringStoreOptions) {
    if ('adapter' in options && options.adapter) {
      this.adapter = options.adapter;
    } else if ('db' in options && options.db) {
      this.adapter = createFirebaseFirestoreAdapter(options.db, {
        preferServerReads: options.preferServerReads ?? true,
      });
    } else {
      throw new Error('Provide either a Firestore `db` instance or a `FirestoreDocumentAdapter`.');
    }

    this.getOwnerId = options.getOwnerId;
    this.collectionPath = options.collectionPath ?? DEFAULT_FIRESTORE_KEYS_COLLECTION;
  }

  private async requireOwnerId(): Promise<string> {
    const raw = await this.getOwnerId();
    const trimmed = raw?.trim();
    if (!trimmed) {
      throw new KeyringSyncAuthExpiredError(
        'Sign in with a verified account to access Firestore DRM keys.'
      );
    }
    return trimmed;
  }

  private buildDocId(ownerId: string, keyId: string): string {
    return `${ownerId}__${keyId}`;
  }

  private toFirestoreDoc(ownerId: string, key: DrmManagedKey): Record<string, unknown> {
    return {
      ownerId,
      keyId: key.keyId,
      label: key.label,
      fingerprint: key.fingerprint,
      generation: key.generation,
      status: key.status,
      isDefault: key.isDefault,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      ...(typeof key.rotatedAt === 'number' ? { rotatedAt: key.rotatedAt } : {}),
      ...(key.rotatedFromKeyId ? { rotatedFromKeyId: key.rotatedFromKeyId } : {}),
      ...(key.rotatedToKeyId ? { rotatedToKeyId: key.rotatedToKeyId } : {}),
      ...(key.keyHint ? { keyHint: key.keyHint } : {}),
      kdf: key.kdf,
      iterations: key.iterations,
      saltB64: key.saltB64,
      wrapIvB64: key.wrapIvB64,
      wrappedKeyB64: key.wrappedKeyB64,
    };
  }

  async listKeys(): Promise<DrmManagedKey[]> {
    const ownerId = await this.requireOwnerId();
    try {
      const docs = await this.adapter.listDocsByOwner(this.collectionPath, ownerId);
      const keys: DrmManagedKey[] = [];
      for (const entry of docs) {
        const clean = sanitizeFirestoreManagedKey(entry.data);
        if (clean) keys.push(clean);
      }
      return keys.sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      throw classifyFirebaseKeyringError(err, 'Failed to list Firestore DRM keys');
    }
  }

  async getKey(keyId: string): Promise<DrmManagedKey | null> {
    const ownerId = await this.requireOwnerId();
    try {
      const raw = await this.adapter.getDoc(
        this.collectionPath,
        this.buildDocId(ownerId, keyId)
      );
      return raw ? sanitizeFirestoreManagedKey(raw) : null;
    } catch (err) {
      throw classifyFirebaseKeyringError(err, 'Failed to load Firestore DRM key');
    }
  }

  async saveKey(key: DrmManagedKey): Promise<void> {
    const ownerId = await this.requireOwnerId();
    try {
      await this.adapter.setDoc(
        this.collectionPath,
        this.buildDocId(ownerId, key.keyId),
        this.toFirestoreDoc(ownerId, key)
      );
    } catch (err) {
      throw classifyFirebaseKeyringError(err, 'Failed to save Firestore DRM key');
    }
  }

  async saveKeysBatch(keys: DrmManagedKey[], replaceAll = false): Promise<void> {
    const ownerId = await this.requireOwnerId();
    try {
      const operations: Array<
        | { type: 'set'; collectionPath: string; docId: string; data: Record<string, unknown> }
        | { type: 'delete'; collectionPath: string; docId: string }
      > = [];

      if (replaceAll) {
        const nextIds = new Set(keys.map((k) => this.buildDocId(ownerId, k.keyId)));
        const existing = await this.adapter.listDocsByOwner(this.collectionPath, ownerId);
        for (const doc of existing) {
          if (!nextIds.has(doc.id)) {
            operations.push({
              type: 'delete',
              collectionPath: this.collectionPath,
              docId: doc.id,
            });
          }
        }
      }

      for (const key of keys) {
        operations.push({
          type: 'set',
          collectionPath: this.collectionPath,
          docId: this.buildDocId(ownerId, key.keyId),
          data: this.toFirestoreDoc(ownerId, key),
        });
      }

      if (this.adapter.batchWrite) {
        await this.adapter.batchWrite(operations);
      } else {
        for (const op of operations) {
          if (op.type === 'set') {
            await this.adapter.setDoc(op.collectionPath, op.docId, op.data);
          } else {
            await this.adapter.deleteDoc(op.collectionPath, op.docId);
          }
        }
      }
    } catch (err) {
      throw classifyFirebaseKeyringError(err, 'Failed to save Firestore DRM keys batch');
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    const ownerId = await this.requireOwnerId();
    try {
      await this.adapter.deleteDoc(this.collectionPath, this.buildDocId(ownerId, keyId));
    } catch (err) {
      throw classifyFirebaseKeyringError(err, 'Failed to delete Firestore DRM key');
    }
  }
}
