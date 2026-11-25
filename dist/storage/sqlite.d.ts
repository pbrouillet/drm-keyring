import type { KeyringStore } from '../storage.js';
import type { CloudKeyringSyncProvider } from '../sync/types.js';
import type { DrmKeyringEncryptedBackup, DrmManagedKey, RemoteKeyringSummary } from '../types.js';
export declare const DEFAULT_SQLITE_KEYS_TABLE = "drm_keys";
export declare const DEFAULT_SQLITE_BACKUPS_TABLE = "drm_keyring_backups";
export type SqliteParam = string | number | bigint | Uint8Array | null;
export interface SqliteExecutor {
    exec(sql: string): void | Promise<void>;
    all<TRow = Record<string, unknown>>(sql: string, params?: readonly SqliteParam[]): TRow[] | Promise<TRow[]>;
    get<TRow = Record<string, unknown>>(sql: string, params?: readonly SqliteParam[]): TRow | null | undefined | Promise<TRow | null | undefined>;
    run(sql: string, params?: readonly SqliteParam[]): unknown | Promise<unknown>;
    transaction?<T>(fn: () => T | Promise<T>): T | Promise<T>;
}
export interface SyncSqliteStatementLike {
    all(...params: SqliteParam[]): unknown[];
    get(...params: SqliteParam[]): unknown;
    run(...params: SqliteParam[]): unknown;
}
export interface SyncSqliteDatabaseLike {
    exec(sql: string): unknown;
    prepare(sql: string): SyncSqliteStatementLike;
}
/**
 * Wraps a synchronous SQLite database instance (`node:sqlite` DatabaseSync, `better-sqlite3`,
 * or `bun:sqlite`) into an async-compatible `SqliteExecutor`.
 */
export declare function createSyncSqliteExecutor(db: SyncSqliteDatabaseLike): SqliteExecutor;
export type SqliteKeyringStoreOptions = ({
    executor: SqliteExecutor;
    database?: undefined;
} | {
    database: SyncSqliteDatabaseLike;
    executor?: undefined;
}) & {
    tableName?: string;
    autoInit?: boolean;
};
/**
 * SQLite-backed `KeyringStore` compatible with Node `node:sqlite`, `better-sqlite3`, `bun:sqlite`,
 * or any custom async `SqliteExecutor` (e.g., Capacitor, Expo SQLite, Tauri, libSQL).
 */
export declare class SqliteKeyringStore implements KeyringStore {
    private readonly executor;
    private readonly tableName;
    private readonly autoInit;
    private initPromise;
    constructor(options: SqliteKeyringStoreOptions);
    init(): Promise<void>;
    private ensureInitialized;
    private upsertSql;
    listKeys(): Promise<DrmManagedKey[]>;
    getKey(keyId: string): Promise<DrmManagedKey | null>;
    saveKey(key: DrmManagedKey): Promise<void>;
    saveKeysBatch(keys: DrmManagedKey[], replaceAll?: boolean): Promise<void>;
    deleteKey(keyId: string): Promise<void>;
}
export type SqliteKeyringSyncProviderOptions = ({
    executor: SqliteExecutor;
    database?: undefined;
} | {
    database: SyncSqliteDatabaseLike;
    executor?: undefined;
}) & {
    ownerId: string | (() => string | null | Promise<string | null>);
    tableName?: string;
    expectedAppId?: string;
    autoInit?: boolean;
};
/**
 * SQLite-backed `CloudKeyringSyncProvider` for server-side SQLite (Node/Bun/libSQL) or
 * multi-tenant encrypted vault storage where the server only stores double-encrypted
 * `DrmKeyringEncryptedBackup` blobs keyed by `ownerId`.
 */
export declare class SqliteKeyringSyncProvider implements CloudKeyringSyncProvider {
    private readonly executor;
    private readonly ownerIdSource;
    private readonly tableName;
    private readonly expectedAppId;
    private readonly autoInit;
    private initPromise;
    constructor(options: SqliteKeyringSyncProviderOptions);
    init(): Promise<void>;
    private ensureInitialized;
    private resolveOwnerId;
    private buildSummary;
    inspect(): Promise<RemoteKeyringSummary | null>;
    pull(): Promise<DrmKeyringEncryptedBackup | null>;
    push(backup: DrmKeyringEncryptedBackup): Promise<RemoteKeyringSummary>;
    delete(): Promise<void>;
}
//# sourceMappingURL=sqlite.d.ts.map