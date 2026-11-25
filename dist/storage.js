export class MemoryKeyringStore {
    keys = new Map();
    constructor(initialKeys = []) {
        for (const key of initialKeys) {
            this.keys.set(key.keyId, { ...key });
        }
    }
    async listKeys() {
        return Array.from(this.keys.values(), (k) => ({ ...k })).sort((a, b) => b.createdAt - a.createdAt);
    }
    async getKey(keyId) {
        const found = this.keys.get(keyId);
        return found ? { ...found } : null;
    }
    async saveKey(key) {
        this.keys.set(key.keyId, { ...key });
    }
    async saveKeysBatch(keys, replaceAll = false) {
        if (replaceAll) {
            this.keys.clear();
        }
        for (const key of keys) {
            this.keys.set(key.keyId, { ...key });
        }
    }
    async deleteKey(keyId) {
        this.keys.delete(keyId);
    }
}
export class IndexedDbKeyringStore {
    dbName;
    dbVersion;
    storeName;
    customOpenDatabase;
    dbPromise = null;
    constructor(options = {}) {
        this.storeName = options.storeName ?? 'drm_keys';
        if ('openDatabase' in options && typeof options.openDatabase === 'function') {
            this.customOpenDatabase = options.openDatabase;
            this.dbName = '';
            this.dbVersion = 1;
        }
        else {
            this.dbName = options.dbName ?? 'drm_keyring_db_v1';
            this.dbVersion = options.dbVersion ?? 1;
        }
    }
    openDb() {
        if (this.customOpenDatabase) {
            return this.customOpenDatabase();
        }
        if (this.dbPromise)
            return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
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
    runTx(mode, executor) {
        return this.openDb().then((db) => new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, mode);
            const store = tx.objectStore(this.storeName);
            const req = executor(store);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }));
    }
    async listKeys() {
        const all = await this.runTx('readonly', (store) => store.getAll());
        return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
    }
    async getKey(keyId) {
        const record = await this.runTx('readonly', (store) => store.get(keyId));
        return record ?? null;
    }
    async saveKey(key) {
        await this.runTx('readwrite', (store) => store.put(key));
    }
    async saveKeysBatch(keys, replaceAll = false) {
        const db = await this.openDb();
        await new Promise((resolve, reject) => {
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
    async deleteKey(keyId) {
        await this.runTx('readwrite', (store) => store.delete(keyId));
    }
}
//# sourceMappingURL=storage.js.map