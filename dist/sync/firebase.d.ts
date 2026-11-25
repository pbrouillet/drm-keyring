import { type Firestore } from 'firebase/firestore';
import type { KeyringStore } from '../storage.js';
import type { DrmKeyringEncryptedBackup, DrmManagedKey, RemoteKeyringSummary } from '../types.js';
import type { CloudKeyringSyncProvider } from './types.js';
export declare const DEFAULT_FIRESTORE_KEYRING_COLLECTION = "drmKeyrings";
export declare const DEFAULT_FIRESTORE_KEYS_COLLECTION = "drmManagedKeys";
export interface FirestoreDocumentAdapter {
    getDoc(collectionPath: string, docId: string): Promise<Record<string, unknown> | null>;
    setDoc(collectionPath: string, docId: string, data: Record<string, unknown>): Promise<void>;
    deleteDoc(collectionPath: string, docId: string): Promise<void>;
    listDocsByOwner(collectionPath: string, ownerId: string): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    batchWrite?(operations: Array<{
        type: 'set';
        collectionPath: string;
        docId: string;
        data: Record<string, unknown>;
    } | {
        type: 'delete';
        collectionPath: string;
        docId: string;
    }>): Promise<void>;
}
export interface CreateFirebaseAdapterOptions {
    /**
     * When `true` (default), reads use `getDocFromServer` / `getDocsFromServer` with graceful
     * fallback to cached `getDoc` / `getDocs` when offline so stale multi-device keyrings are avoided.
     */
    preferServerReads?: boolean;
}
/**
 * Wraps a modular Firebase Web SDK `Firestore` instance into a `FirestoreDocumentAdapter`.
 */
export declare function createFirebaseFirestoreAdapter(db: Firestore, options?: CreateFirebaseAdapterOptions): FirestoreDocumentAdapter;
export declare function classifyFirebaseKeyringError(err: unknown, contextMessage?: string): Error;
export interface FirestoreKeyringBackupDoc extends DrmKeyringEncryptedBackup {
    ownerId: string;
    sizeBytes: number;
    modifiedTime: string;
    updatedAt: number;
}
export type FirebaseKeyringSyncProviderOptions = ({
    db: Firestore;
    adapter?: undefined;
} | {
    adapter: FirestoreDocumentAdapter;
    db?: undefined;
}) & {
    getOwnerId: (options?: {
        interactive?: boolean;
    }) => string | null | Promise<string | null>;
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
export declare class FirebaseKeyringSyncProvider implements CloudKeyringSyncProvider {
    private readonly adapter;
    private readonly getOwnerId;
    private readonly collectionPath;
    private readonly documentIdOption?;
    private readonly expectedAppId;
    private readonly onAuthExpired?;
    private readonly onPermissionScopeError?;
    constructor(options: FirebaseKeyringSyncProviderOptions);
    private resolveDocId;
    private requireOwnerId;
    private handleError;
    private extractBackupFromDoc;
    private buildSummary;
    inspect(options?: {
        interactive?: boolean;
    }): Promise<RemoteKeyringSummary | null>;
    pull(options?: {
        interactive?: boolean;
    }): Promise<DrmKeyringEncryptedBackup | null>;
    push(backup: DrmKeyringEncryptedBackup, options?: {
        interactive?: boolean;
    }): Promise<RemoteKeyringSummary>;
    delete(options?: {
        interactive?: boolean;
    }): Promise<void>;
}
export type FirestoreKeyringStoreOptions = ({
    db: Firestore;
    adapter?: undefined;
} | {
    adapter: FirestoreDocumentAdapter;
    db?: undefined;
}) & {
    getOwnerId: () => string | null | Promise<string | null>;
    collectionPath?: string;
    preferServerReads?: boolean;
};
/**
 * Cloud Firestore `KeyringStore` storing already-wrapped `DrmManagedKey` records scoped per `ownerId`.
 * Suitable when an app wants per-key Firestore persistence (with `firestore.drm-keyring.rules`).
 */
export declare class FirestoreKeyringStore implements KeyringStore {
    private readonly adapter;
    private readonly getOwnerId;
    private readonly collectionPath;
    constructor(options: FirestoreKeyringStoreOptions);
    private requireOwnerId;
    private buildDocId;
    private toFirestoreDoc;
    listKeys(): Promise<DrmManagedKey[]>;
    getKey(keyId: string): Promise<DrmManagedKey | null>;
    saveKey(key: DrmManagedKey): Promise<void>;
    saveKeysBatch(keys: DrmManagedKey[], replaceAll?: boolean): Promise<void>;
    deleteKey(keyId: string): Promise<void>;
}
//# sourceMappingURL=firebase.d.ts.map