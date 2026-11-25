import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagedDrmKey,
  IndexedDbKeyringStore,
  MemoryKeyringStore,
  type DrmManagedKey,
} from '../src/index.js';

function createMockIdbDatabase(storeName: string): IDBDatabase {
  const records = new Map<string, DrmManagedKey>();

  const makeRequest = <T>(compute: () => T): IDBRequest<T> => {
    const req: {
      result: T | undefined;
      error: DOMException | null;
      onsuccess: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
    } = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };

    queueMicrotask(() => {
      req.result = compute();
      req.onsuccess?.(new Event('success'));
    });
    return req as unknown as IDBRequest<T>;
  };

  const mockDb = {
    transaction(_names: string | string[], _mode: IDBTransactionMode) {
      let pendingOps = 0;
      const tx: {
        oncomplete: ((ev: Event) => void) | null;
        onerror: ((ev: Event) => void) | null;
        objectStore: (name: string) => IDBObjectStore;
      } = {
        oncomplete: null,
        onerror: null,
        objectStore(name: string) {
          assert.equal(name, storeName);
          const wrapOp = <T>(fn: () => T): IDBRequest<T> => {
            pendingOps += 1;
            const req = makeRequest(fn);
            const origQueue = req.onsuccess;
            queueMicrotask(() => {
              pendingOps -= 1;
              if (pendingOps === 0) {
                tx.oncomplete?.(new Event('complete'));
              }
            });
            void origQueue;
            return req;
          };

          return {
            getAll: () => wrapOp(() => Array.from(records.values())),
            get: (key: string) => wrapOp(() => records.get(key)),
            put: (val: DrmManagedKey) =>
              wrapOp(() => {
                records.set(val.keyId, val);
                return val.keyId;
              }),
            delete: (key: string) =>
              wrapOp(() => {
                records.delete(key);
                return undefined;
              }),
            clear: () =>
              wrapOp(() => {
                records.clear();
                return undefined;
              }),
          } as unknown as IDBObjectStore;
        },
      };

      // Handle transactions with 0 ops if needed
      queueMicrotask(() => {
        if (pendingOps === 0) {
          tx.oncomplete?.(new Event('complete'));
        }
      });

      return tx as unknown as IDBTransaction;
    },
  };

  return mockDb as unknown as IDBDatabase;
}

test('MemoryKeyringStore supports CRUD, sorting, and replaceAll batches', async () => {
  const k1 = await createManagedDrmKey({
    label: 'Key 1',
    passphrase: 'passphrase-one',
    iterations: 10_000,
  });
  const k2 = await createManagedDrmKey({
    label: 'Key 2',
    passphrase: 'passphrase-two',
    iterations: 10_000,
  });
  k1.createdAt = 1000;
  k2.createdAt = 2000;

  const store = new MemoryKeyringStore();
  await store.saveKey(k1);
  await store.saveKey(k2);

  const listed = await store.listKeys();
  assert.deepEqual(
    listed.map((k) => k.keyId),
    [k2.keyId, k1.keyId]
  );
  assert.equal((await store.getKey(k1.keyId))?.label, 'Key 1');

  await store.saveKeysBatch([k1], true);
  assert.equal((await store.listKeys()).length, 1);

  await store.deleteKey(k1.keyId);
  assert.equal(await store.getKey(k1.keyId), null);
});

test('IndexedDbKeyringStore delegates cleanly to custom openDatabase', async () => {
  const mockDb = createMockIdbDatabase('drm_keys');
  const store = new IndexedDbKeyringStore({
    openDatabase: async () => mockDb,
    storeName: 'drm_keys',
  });

  const k1 = await createManagedDrmKey({
    label: 'IDB Key 1',
    passphrase: 'idb-passphrase-1',
    iterations: 10_000,
  });
  const k2 = await createManagedDrmKey({
    label: 'IDB Key 2',
    passphrase: 'idb-passphrase-2',
    iterations: 10_000,
  });

  await store.saveKey(k1);
  assert.equal((await store.getKey(k1.keyId))?.label, 'IDB Key 1');

  await store.saveKeysBatch([k2], true);
  const all = await store.listKeys();
  assert.deepEqual(
    all.map((k) => k.keyId),
    [k2.keyId]
  );

  await store.deleteKey(k2.keyId);
  assert.deepEqual(await store.listKeys(), []);
});
