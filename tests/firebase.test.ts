import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagedDrmKey,
  DrmKeyringManager,
  encryptDrmKeyringBackup,
  KeyringSyncAuthExpiredError,
  KeyringSyncPermissionScopeError,
  MemoryKeyringStore,
} from '../src/index.js';
import {
  classifyFirebaseKeyringError,
  FirebaseKeyringSyncProvider,
  FirestoreKeyringStore,
  type FirestoreDocumentAdapter,
} from '../src/sync/firebase.js';

function createMemoryFirestoreAdapter(): {
  adapter: FirestoreDocumentAdapter;
  collections: Map<string, Map<string, Record<string, unknown>>>;
} {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();

  const ensureCollection = (path: string) => {
    let col = collections.get(path);
    if (!col) {
      col = new Map();
      collections.set(path, col);
    }
    return col;
  };

  const adapter: FirestoreDocumentAdapter = {
    async getDoc(collectionPath, docId) {
      const col = ensureCollection(collectionPath);
      const doc = col.get(docId);
      return doc ? structuredClone(doc) : null;
    },
    async setDoc(collectionPath, docId, data) {
      const col = ensureCollection(collectionPath);
      col.set(docId, structuredClone(data));
    },
    async deleteDoc(collectionPath, docId) {
      const col = ensureCollection(collectionPath);
      col.delete(docId);
    },
    async listDocsByOwner(collectionPath, ownerId) {
      const col = ensureCollection(collectionPath);
      const out: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const [id, data] of col.entries()) {
        if (data.ownerId === ownerId) {
          out.push({ id, data: structuredClone(data) });
        }
      }
      return out;
    },
    async batchWrite(operations) {
      for (const op of operations) {
        if (op.type === 'set') {
          await adapter.setDoc(op.collectionPath, op.docId, op.data);
        } else {
          await adapter.deleteDoc(op.collectionPath, op.docId);
        }
      }
    },
  };

  return { adapter, collections };
}

test('FirebaseKeyringSyncProvider handles inspect, push, pull, delete, multi-device sync, and owner isolation', async () => {
  const { adapter, collections } = createMemoryFirestoreAdapter();

  let currentUidA: string | null = 'user-alpha';
  const providerA = new FirebaseKeyringSyncProvider({
    adapter,
    getOwnerId: () => currentUidA,
  });
  const providerB = new FirebaseKeyringSyncProvider({
    adapter,
    getOwnerId: () => 'user-alpha',
  });
  const providerOtherUser = new FirebaseKeyringSyncProvider({
    adapter,
    getOwnerId: () => 'user-beta',
  });

  // Empty initially
  assert.equal(await providerA.inspect({ interactive: false }), null);
  assert.equal(await providerA.pull(), null);

  // Unauthenticated interactive inspect returns null; pull throws KeyringSyncAuthExpiredError
  currentUidA = null;
  assert.equal(await providerA.inspect({ interactive: false }), null);
  await assert.rejects(() => providerA.pull(), KeyringSyncAuthExpiredError);
  currentUidA = 'user-alpha';

  // Multi-device DrmKeyringManager sync via Firestore
  const managerA = new DrmKeyringManager({
    store: new MemoryKeyringStore(),
    syncProvider: providerA,
  });
  await managerA.load();
  const k1 = await managerA.createKey({
    label: 'Firestore Alpha Key',
    passphrase: 'firestore-key-passphrase-1',
    iterations: 10_000,
  });
  await managerA.enableAndUnlockCloudSync({
    masterPassphrase: 'firestore-master-vault-1',
    backupHint: 'Personal laptop',
    iterations: 10_000,
  });

  // Stored document contains zero plaintext passphrases and matches ownerId
  const storedDoc = collections.get('drmKeyrings')?.get('user-alpha');
  assert.ok(storedDoc);
  assert.equal(storedDoc.ownerId, 'user-alpha');
  assert.equal(storedDoc.keyCount, 1);
  assert.equal(JSON.stringify(storedDoc).includes('firestore-key-passphrase-1'), false);
  assert.equal(JSON.stringify(storedDoc).includes('firestore-master-vault-1'), false);

  // Other user cannot see user-alpha's keyring
  assert.equal(await providerOtherUser.inspect(), null);
  assert.equal(await providerOtherUser.pull(), null);

  // Device B (same user) unlocks and pulls key
  const managerB = new DrmKeyringManager({
    store: new MemoryKeyringStore(),
    syncProvider: providerB,
  });
  await managerB.load();
  const unlockB = await managerB.enableAndUnlockCloudSync({
    masterPassphrase: 'firestore-master-vault-1',
    iterations: 10_000,
  });
  assert.equal(unlockB.mergedCount, 1);
  assert.equal(managerB.getState().keys[0]?.keyId, k1.keyId);

  // Inspect & delete
  const inspected = await providerA.inspect();
  assert.equal(inspected?.fileId, 'drmKeyrings/user-alpha');
  assert.equal(inspected?.header?.keyCount, 1);

  await providerA.delete();
  assert.equal(await providerA.inspect(), null);

  managerA.dispose();
  managerB.dispose();
});

test('FirebaseKeyringSyncProvider classifies unauthenticated and permission-denied errors and triggers hooks', async () => {
  let authExpiredCount = 0;
  let scopeErrorCount = 0;

  const failingAdapter: FirestoreDocumentAdapter = {
    async getDoc() {
      const err = new Error('Missing or insufficient permissions.') as Error & { code: string };
      err.code = 'permission-denied';
      throw err;
    },
    async setDoc() {
      const err = new Error('User session expired.') as Error & { code: string };
      err.code = 'unauthenticated';
      throw err;
    },
    async deleteDoc() {},
    async listDocsByOwner() {
      return [];
    },
  };

  const provider = new FirebaseKeyringSyncProvider({
    adapter: failingAdapter,
    getOwnerId: () => 'uid-err-test',
    onAuthExpired: () => {
      authExpiredCount += 1;
    },
    onPermissionScopeError: () => {
      scopeErrorCount += 1;
    },
  });

  await assert.rejects(() => provider.pull(), KeyringSyncPermissionScopeError);
  assert.equal(scopeErrorCount, 1);

  const key = await createManagedDrmKey({
    label: 'Err Test',
    passphrase: 'test-passphrase-123',
    iterations: 10_000,
  });
  const backup = await encryptDrmKeyringBackup([key], 'backup-pass-123', {
    iterations: 10_000,
  });

  await assert.rejects(() => provider.push(backup), KeyringSyncAuthExpiredError);
  assert.equal(authExpiredCount, 1);

  assert.ok(
    classifyFirebaseKeyringError({ code: 'auth/id-token-expired', message: 'expired' }) instanceof
      KeyringSyncAuthExpiredError
  );
});

test('FirestoreKeyringStore supports CRUD, sorting, replaceAll batching, and owner isolation', async () => {
  const { adapter } = createMemoryFirestoreAdapter();

  const storeUserA = new FirestoreKeyringStore({
    adapter,
    getOwnerId: () => 'uid-a',
  });
  const storeUserB = new FirestoreKeyringStore({
    adapter,
    getOwnerId: () => 'uid-b',
  });

  const k1 = await createManagedDrmKey({
    label: 'Key One',
    passphrase: 'passphrase-one-123',
    isDefault: true,
    iterations: 10_000,
  });
  const k2 = {
    ...(await createManagedDrmKey({
      label: 'Key Two',
      passphrase: 'passphrase-two-123',
      isDefault: false,
      iterations: 10_000,
    })),
    createdAt: k1.createdAt + 1000,
    updatedAt: k1.updatedAt + 1000,
  };
  const kOther = await createManagedDrmKey({
    label: 'Other User Key',
    passphrase: 'passphrase-other-123',
    iterations: 10_000,
  });

  await storeUserA.saveKey(k1);
  await storeUserA.saveKey(k2);
  await storeUserB.saveKey(kOther);

  const listA = await storeUserA.listKeys();
  assert.equal(listA.length, 2);
  assert.equal(listA[0].keyId, k2.keyId);
  assert.equal((await storeUserA.getKey(k1.keyId))?.label, 'Key One');
  assert.equal((await storeUserB.listKeys()).length, 1);

  // replaceAll keeps only the new batch for user A while leaving user B untouched
  await storeUserA.saveKeysBatch([k1], true);
  const afterReplaceA = await storeUserA.listKeys();
  assert.equal(afterReplaceA.length, 1);
  assert.equal(afterReplaceA[0].keyId, k1.keyId);
  assert.equal((await storeUserB.listKeys()).length, 1);

  await storeUserA.deleteKey(k1.keyId);
  assert.equal((await storeUserA.listKeys()).length, 0);
});
