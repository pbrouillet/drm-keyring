import type { DrmManagedKey } from './types.js';
export interface KeyringStore {
    listKeys(): Promise<DrmManagedKey[]>;
    getKey(keyId: string): Promise<DrmManagedKey | null>;
    saveKey(key: DrmManagedKey): Promise<void>;
    saveKeysBatch(keys: DrmManagedKey[], replaceAll?: boolean): Promise<void>;
    deleteKey(keyId: string): Promise<void>;
}
export declare class MemoryKeyringStore implements KeyringStore {
    private readonly keys;
    constructor(initialKeys?: DrmManagedKey[]);
    listKeys(): Promise<DrmManagedKey[]>;
    getKey(keyId: string): Promise<DrmManagedKey | null>;
    saveKey(key: DrmManagedKey): Promise<void>;
    saveKeysBatch(keys: DrmManagedKey[], replaceAll?: boolean): Promise<void>;
    deleteKey(keyId: string): Promise<void>;
}
export type IndexedDbKeyringStoreOptions = {
    dbName?: string;
    dbVersion?: number;
    storeName?: string;
    openDatabase?: undefined;
} | {
    openDatabase: () => Promise<IDBDatabase>;
    storeName?: string;
    dbName?: undefined;
    dbVersion?: undefined;
};
export declare class IndexedDbKeyringStore implements KeyringStore {
    private readonly dbName;
    private readonly dbVersion;
    private readonly storeName;
    private readonly customOpenDatabase?;
    private dbPromise;
    constructor(options?: IndexedDbKeyringStoreOptions);
    private openDb;
    private runTx;
    listKeys(): Promise<DrmManagedKey[]>;
    getKey(keyId: string): Promise<DrmManagedKey | null>;
    saveKey(key: DrmManagedKey): Promise<void>;
    saveKeysBatch(keys: DrmManagedKey[], replaceAll?: boolean): Promise<void>;
    deleteKey(keyId: string): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map