import { DEFAULT_DRM_PROTOCOL_PROFILE } from '../constants.js';
import { DrmContainerFormatError } from '../errors.js';
import { parseDrmKeyringBackupJson } from '../keyringCrypto.js';
import type { KeyringStore } from '../storage.js';
import type { CloudKeyringSyncProvider } from '../sync/types.js';
import type {
  DrmKeyringEncryptedBackup,
  DrmManagedKey,
  RemoteKeyringSummary,
} from '../types.js';

export const DEFAULT_SQLITE_KEYS_TABLE = 'drm_keys';
export const DEFAULT_SQLITE_BACKUPS_TABLE = 'drm_keyring_backups';

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type SqliteParam = string | number | bigint | Uint8Array | null;

export interface SqliteExecutor {
  exec(sql: string): void | Promise<void>;
  all<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly SqliteParam[]
  ): TRow[] | Promise<TRow[]>;
  get<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly SqliteParam[]
  ): TRow | null | undefined | Promise<TRow | null | undefined>;
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

function validateSqlIdentifier(identifier: string, label: string): string {
  const trimmed = identifier.trim();
  if (!SQL_IDENTIFIER_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid SQLite ${label} "${identifier}". Only ASCII letters, digits, and underscores are allowed.`
    );
  }
  return trimmed;
}

/**
 * Wraps a synchronous SQLite database instance (`node:sqlite` DatabaseSync, `better-sqlite3`,
 * or `bun:sqlite`) into an async-compatible `SqliteExecutor`.
 */
export function createSyncSqliteExecutor(db: SyncSqliteDatabaseLike): SqliteExecutor {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    all<TRow = Record<string, unknown>>(
      sql: string,
      params: readonly SqliteParam[] = []
    ): TRow[] {
      return db.prepare(sql).all(...params) as TRow[];
    },
    get<TRow = Record<string, unknown>>(
      sql: string,
      params: readonly SqliteParam[] = []
    ): TRow | undefined {
      return db.prepare(sql).get(...params) as TRow | undefined;
    },
    run(sql: string, params: readonly SqliteParam[] = []): unknown {
      return db.prepare(sql).run(...params);
    },
    async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure when original error already occurred
        }
        throw err;
      }
    },
  };
}

function resolveExecutor(
  options: { executor: SqliteExecutor } | { database: SyncSqliteDatabaseLike }
): SqliteExecutor {
  if ('executor' in options && options.executor) {
    return options.executor;
  }
  if ('database' in options && options.database) {
    return createSyncSqliteExecutor(options.database);
  }
  throw new Error('Provide either a SqliteExecutor (`executor`) or a synchronous SQLite `database`.');
}

interface SqliteDrmKeyRow {
  key_id: string;
  label: string;
  fingerprint: string;
  generation: number;
  status: string;
  is_default: number;
  created_at: number;
  updated_at: number;
  rotated_at: number | null;
  rotated_from_key_id: string | null;
  rotated_to_key_id: string | null;
  key_hint: string | null;
  kdf: string;
  iterations: number;
  salt_b64: string;
  wrap_iv_b64: string;
  wrapped_key_b64: string;
}

function rowToManagedKey(row: SqliteDrmKeyRow): DrmManagedKey {
  return {
    keyId: row.key_id,
    label: row.label,
    fingerprint: row.fingerprint,
    generation: row.generation,
    status: row.status === 'retired' ? 'retired' : 'active',
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(typeof row.rotated_at === 'number' ? { rotatedAt: row.rotated_at } : {}),
    ...(row.rotated_from_key_id ? { rotatedFromKeyId: row.rotated_from_key_id } : {}),
    ...(row.rotated_to_key_id ? { rotatedToKeyId: row.rotated_to_key_id } : {}),
    ...(row.key_hint ? { keyHint: row.key_hint } : {}),
    kdf: 'PBKDF2-SHA256',
    iterations: row.iterations,
    saltB64: row.salt_b64,
    wrapIvB64: row.wrap_iv_b64,
    wrappedKeyB64: row.wrapped_key_b64,
  };
}

function managedKeyToParams(key: DrmManagedKey): SqliteParam[] {
  return [
    key.keyId,
    key.label,
    key.fingerprint,
    key.generation,
    key.status,
    key.isDefault ? 1 : 0,
    key.createdAt,
    key.updatedAt,
    key.rotatedAt ?? null,
    key.rotatedFromKeyId ?? null,
    key.rotatedToKeyId ?? null,
    key.keyHint ?? null,
    key.kdf,
    key.iterations,
    key.saltB64,
    key.wrapIvB64,
    key.wrappedKeyB64,
  ];
}

export type SqliteKeyringStoreOptions = (
  | { executor: SqliteExecutor; database?: undefined }
  | { database: SyncSqliteDatabaseLike; executor?: undefined }
) & {
  tableName?: string;
  autoInit?: boolean;
};

/**
 * SQLite-backed `KeyringStore` compatible with Node `node:sqlite`, `better-sqlite3`, `bun:sqlite`,
 * or any custom async `SqliteExecutor` (e.g., Capacitor, Expo SQLite, Tauri, libSQL).
 */
export class SqliteKeyringStore implements KeyringStore {
  private readonly executor: SqliteExecutor;
  private readonly tableName: string;
  private readonly autoInit: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(options: SqliteKeyringStoreOptions) {
    this.executor = resolveExecutor(options);
    this.tableName = validateSqlIdentifier(
      options.tableName ?? DEFAULT_SQLITE_KEYS_TABLE,
      'tableName'
    );
    this.autoInit = options.autoInit ?? true;
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.executor.exec(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            key_id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            generation INTEGER NOT NULL,
            status TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            rotated_at INTEGER,
            rotated_from_key_id TEXT,
            rotated_to_key_id TEXT,
            key_hint TEXT,
            kdf TEXT NOT NULL,
            iterations INTEGER NOT NULL,
            salt_b64 TEXT NOT NULL,
            wrap_iv_b64 TEXT NOT NULL,
            wrapped_key_b64 TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at
            ON ${this.tableName} (created_at DESC);
        `);
      })().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.autoInit) {
      await this.init();
    }
  }

  private upsertSql(): string {
    return `
      INSERT INTO ${this.tableName} (
        key_id, label, fingerprint, generation, status, is_default,
        created_at, updated_at, rotated_at, rotated_from_key_id, rotated_to_key_id,
        key_hint, kdf, iterations, salt_b64, wrap_iv_b64, wrapped_key_b64
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key_id) DO UPDATE SET
        label = excluded.label,
        fingerprint = excluded.fingerprint,
        generation = excluded.generation,
        status = excluded.status,
        is_default = excluded.is_default,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        rotated_at = excluded.rotated_at,
        rotated_from_key_id = excluded.rotated_from_key_id,
        rotated_to_key_id = excluded.rotated_to_key_id,
        key_hint = excluded.key_hint,
        kdf = excluded.kdf,
        iterations = excluded.iterations,
        salt_b64 = excluded.salt_b64,
        wrap_iv_b64 = excluded.wrap_iv_b64,
        wrapped_key_b64 = excluded.wrapped_key_b64
    `;
  }

  async listKeys(): Promise<DrmManagedKey[]> {
    await this.ensureInitialized();
    const rows = await this.executor.all<SqliteDrmKeyRow>(
      `SELECT
        key_id, label, fingerprint, generation, status, is_default,
        created_at, updated_at, rotated_at, rotated_from_key_id, rotated_to_key_id,
        key_hint, kdf, iterations, salt_b64, wrap_iv_b64, wrapped_key_b64
      FROM ${this.tableName}
      ORDER BY created_at DESC`
    );
    return rows.map(rowToManagedKey);
  }

  async getKey(keyId: string): Promise<DrmManagedKey | null> {
    await this.ensureInitialized();
    const row = await this.executor.get<SqliteDrmKeyRow>(
      `SELECT
        key_id, label, fingerprint, generation, status, is_default,
        created_at, updated_at, rotated_at, rotated_from_key_id, rotated_to_key_id,
        key_hint, kdf, iterations, salt_b64, wrap_iv_b64, wrapped_key_b64
      FROM ${this.tableName}
      WHERE key_id = ?`,
      [keyId]
    );
    return row ? rowToManagedKey(row) : null;
  }

  async saveKey(key: DrmManagedKey): Promise<void> {
    await this.ensureInitialized();
    await this.executor.run(this.upsertSql(), managedKeyToParams(key));
  }

  async saveKeysBatch(keys: DrmManagedKey[], replaceAll = false): Promise<void> {
    await this.ensureInitialized();
    const runBatch = async () => {
      if (replaceAll) {
        await this.executor.run(`DELETE FROM ${this.tableName}`);
      }
      const sql = this.upsertSql();
      for (const key of keys) {
        await this.executor.run(sql, managedKeyToParams(key));
      }
    };

    if (this.executor.transaction) {
      await this.executor.transaction(runBatch);
    } else {
      await runBatch();
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    await this.ensureInitialized();
    await this.executor.run(`DELETE FROM ${this.tableName} WHERE key_id = ?`, [keyId]);
  }
}

interface SqliteBackupRow {
  owner_id: string;
  backup_json: string;
  size_bytes: number;
  modified_time: string;
  updated_at: number;
}

export type SqliteKeyringSyncProviderOptions = (
  | { executor: SqliteExecutor; database?: undefined }
  | { database: SyncSqliteDatabaseLike; executor?: undefined }
) & {
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
export class SqliteKeyringSyncProvider implements CloudKeyringSyncProvider {
  private readonly executor: SqliteExecutor;
  private readonly ownerIdSource: string | (() => string | null | Promise<string | null>);
  private readonly tableName: string;
  private readonly expectedAppId: string;
  private readonly autoInit: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(options: SqliteKeyringSyncProviderOptions) {
    this.executor = resolveExecutor(options);
    this.ownerIdSource = options.ownerId;
    this.tableName = validateSqlIdentifier(
      options.tableName ?? DEFAULT_SQLITE_BACKUPS_TABLE,
      'tableName'
    );
    this.expectedAppId = options.expectedAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.keyringBackupAppId;
    this.autoInit = options.autoInit ?? true;
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.executor.exec(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            owner_id TEXT PRIMARY KEY,
            backup_json TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            modified_time TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);
      })().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.autoInit) {
      await this.init();
    }
  }

  private async resolveOwnerId(required: boolean): Promise<string | null> {
    const raw =
      typeof this.ownerIdSource === 'function'
        ? await this.ownerIdSource()
        : this.ownerIdSource;
    const trimmed = raw?.trim() || null;
    if (!trimmed && required) {
      throw new Error('SQLite keyring sync requires a non-empty ownerId.');
    }
    return trimmed;
  }

  private buildSummary(
    ownerId: string,
    modifiedTime: string,
    sizeBytes: number,
    backup?: DrmKeyringEncryptedBackup
  ): RemoteKeyringSummary {
    return {
      fileId: `sqlite:${this.tableName}:${ownerId}`,
      modifiedTime,
      sizeBytes,
      ...(backup
        ? {
            header: {
              schemaVersion: 1,
              app: backup.app,
              backupId: backup.backupId,
              createdAt: backup.createdAt,
              keyCount: backup.keyCount,
              keyFingerprints: [...backup.keyFingerprints],
              ...(backup.backupHint ? { backupHint: backup.backupHint } : {}),
            },
          }
        : {}),
    };
  }

  async inspect(): Promise<RemoteKeyringSummary | null> {
    await this.ensureInitialized();
    const ownerId = await this.resolveOwnerId(false);
    if (!ownerId) return null;

    const row = await this.executor.get<SqliteBackupRow>(
      `SELECT owner_id, backup_json, size_bytes, modified_time, updated_at
       FROM ${this.tableName}
       WHERE owner_id = ?`,
      [ownerId]
    );
    if (!row) return null;

    let parsed: DrmKeyringEncryptedBackup | undefined;
    try {
      parsed = parseDrmKeyringBackupJson(row.backup_json, {
        expectedAppId: this.expectedAppId,
      });
    } catch {
      parsed = undefined;
    }

    return this.buildSummary(ownerId, row.modified_time, row.size_bytes, parsed);
  }

  async pull(): Promise<DrmKeyringEncryptedBackup | null> {
    await this.ensureInitialized();
    const ownerId = await this.resolveOwnerId(true);
    if (!ownerId) return null;

    const row = await this.executor.get<SqliteBackupRow>(
      `SELECT owner_id, backup_json, size_bytes, modified_time, updated_at
       FROM ${this.tableName}
       WHERE owner_id = ?`,
      [ownerId]
    );
    if (!row) return null;

    return parseDrmKeyringBackupJson(row.backup_json, {
      expectedAppId: this.expectedAppId,
    });
  }

  async push(backup: DrmKeyringEncryptedBackup): Promise<RemoteKeyringSummary> {
    await this.ensureInitialized();
    const ownerId = await this.resolveOwnerId(true);
    if (!ownerId) {
      throw new DrmContainerFormatError('Missing ownerId for SQLite keyring push.');
    }

    const json = JSON.stringify(backup);
    const sizeBytes = new TextEncoder().encode(json).byteLength;
    const now = Date.now();
    const modifiedTime = new Date(now).toISOString();

    await this.executor.run(
      `INSERT INTO ${this.tableName} (
        owner_id, backup_json, size_bytes, modified_time, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        backup_json = excluded.backup_json,
        size_bytes = excluded.size_bytes,
        modified_time = excluded.modified_time,
        updated_at = excluded.updated_at`,
      [ownerId, json, sizeBytes, modifiedTime, now]
    );

    return this.buildSummary(ownerId, modifiedTime, sizeBytes, backup);
  }

  async delete(): Promise<void> {
    await this.ensureInitialized();
    const ownerId = await this.resolveOwnerId(true);
    if (!ownerId) return;
    await this.executor.run(`DELETE FROM ${this.tableName} WHERE owner_id = ?`, [ownerId]);
  }
}
