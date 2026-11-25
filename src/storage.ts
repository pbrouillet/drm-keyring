import type { DrmManagedKey } from './types.js';

export interface KeyringStore {
  listKeys(): Promise<DrmManagedKey[]>;
  getKey(keyId: string): Promise<DrmManagedKey | null>;
  saveKey(key: DrmManagedKey): Promise<void>;
  saveKeysBatch(keys: DrmManagedKey[], replaceAll?: boolean): Promise<void>;
  deleteKey(keyId: string): Promise<void>;
}

export class MemoryKeyringStore implements KeyringStore {
  private readonly keys = new Map<string, DrmManagedKey>();

  constructor(initialKeys: DrmManagedKey[] = []) {
    for (const key of initialKeys) {
      this.keys.set(key.keyId, { ...key });
    }
  }

  async listKeys(): Promise<DrmManagedKey[]> {
    return Array.from(this.keys.values(), (k) => ({ ...k })).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  async getKey(keyId: string): Promise<DrmManagedKey | null> {
    const found = this.keys.get(keyId);
    return found ? { ...found } : null;
  }

  async saveKey(key: DrmManagedKey): Promise<void> {
    this.keys.set(key.keyId, { ...key });
  }

  async saveKeysBatch(keys: DrmManagedKey[], replaceAll = false): Promise<void> {
    if (replaceAll) {
      this.keys.clear();
    }
    for (const key of keys) {
      this.keys.set(key.keyId, { ...key });
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    this.keys.delete(keyId);
  }
}

export type IndexedDbKeyringStoreOptions =
  | {
      dbName?: string;
      dbVersion?: number;
      storeName?: string;
      openDatabase?: undefined;
    }
  | {
      openDatabase: () => Promise<IDBDatabase>;
      storeName?: string;
      dbName?: undefined;
      dbVersion?: undefined;
    };

export class IndexedDbKeyringStore implements KeyringStore {
  private readonly dbName: string;
  private readonly dbVersion: number;
  private readonly storeName: string;
  private readonly customOpenDatabase?: () => Promise<IDBDatabase>;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbKeyringStoreOptions = {}) {
    this.storeName = options.storeName ?? 'drm_keys';
    if ('openDatabase' in options && typeof options.openDatabase === 'function') {
      this.customOpenDatabase = options.openDatabase;
      this.dbName = '';
      this.dbVersion = 1;
    } else {
      this.dbName = options.dbName ?? 'drm_keyring_db_v1';
      this.dbVersion = options.dbVersion ?? 1;
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.customOpenDatabase) {
      return this.customOpenDatabase();
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable in this environment.'));
        return;
      }
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'keyId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  private runTx<T>(
    mode: IDBTransactionMode,
    executor: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    return this.openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(this.storeName, mode);
          const store = tx.objectStore(this.storeName);
          const req = executor(store);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  async listKeys(): Promise<DrmManagedKey[]> {
    const all = await this.runTx<DrmManagedKey[]>('readonly', (store) => store.getAll());
    return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getKey(keyId: string): Promise<DrmManagedKey | null> {
    const record = await this.runTx<DrmManagedKey | undefined>('readonly', (store) =>
      store.get(keyId)
    );
    return record ?? null;
  }

  async saveKey(key: DrmManagedKey): Promise<void> {
    await this.runTx('readwrite', (store) => store.put(key));
  }

  async saveKeysBatch(keys: DrmManagedKey[], replaceAll = false): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      if (replaceAll) {
        store.clear();
      }
      for (const key of keys) {
        store.put(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteKey(keyId: string): Promise<void> {
    await this.runTx('readwrite', (store) => store.delete(keyId));
  }
}
