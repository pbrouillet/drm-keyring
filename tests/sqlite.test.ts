import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createManagedDrmKey, DrmKeyringManager } from '../src/index.js';
import {
  SqliteKeyringStore,
  SqliteKeyringSyncProvider,
  type SqliteExecutor,
  type SqliteParam,
} from '../src/storage/sqlite.js';

test('SqliteKeyringStore persists, sorts, replaces atomically, and rejects unsafe table names against node:sqlite', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.throws(
      () => new SqliteKeyringStore({ database: db, tableName: 'drm_keys; DROP TABLE users;--' }),
      /Invalid SQLite tableName/
    );

    const store = new SqliteKeyringStore({ database: db });
    assert.deepEqual(await store.listKeys(), []);
    assert.equal(await store.getKey('missing'), null);

    const key1 = await createManagedDrmKey({
      label: 'SQLite Key 1',
      passphrase: 'sqlite-passphrase-1',
      keyHint: 'First hint',
      isDefault: true,
      iterations: 10_000,
    });
    const key2 = {
      ...(await createManagedDrmKey({
        label: 'SQLite Key 2',
        passphrase: 'sqlite-passphrase-2',
        isDefault: false,
        iterations: 10_000,
      })),
      createdAt: key1.createdAt + 2000,
      updatedAt: key1.updatedAt + 2000,
    };

    await store.saveKey(key1);
    await store.saveKey(key2);

    const listed = await store.listKeys();
    assert.equal(listed.length, 2);
    assert.equal(listed[0].keyId, key2.keyId);
    assert.equal(listed[1].keyId, key1.keyId);
    assert.equal(listed[1].keyHint, 'First hint');
    assert.equal(listed[1].isDefault, true);
    assert.equal(listed[0].isDefault, false);

    const loadedOne = await store.getKey(key1.keyId);
    assert.deepEqual(loadedOne, key1);

    // Atomic replaceAll batch removes unlisted keys
    await store.saveKeysBatch([key2], true);
    const afterReplace = await store.listKeys();
    assert.equal(afterReplace.length, 1);
    assert.equal(afterReplace[0].keyId, key2.keyId);

    await store.deleteKey(key2.keyId);
    assert.deepEqual(await store.listKeys(), []);
  } finally {
    db.close();
  }
});

test('SqliteKeyringStore + SqliteKeyringSyncProvider drive full DrmKeyringManager multi-device E2EE sync', async () => {
  const localDbA = new DatabaseSync(':memory:');
  const localDbB = new DatabaseSync(':memory:');
  const sharedServerDb = new DatabaseSync(':memory:');

  try {
    const storeA = new SqliteKeyringStore({ database: localDbA });
    const storeB = new SqliteKeyringStore({ database: localDbB });

    const syncA = new SqliteKeyringSyncProvider({
      database: sharedServerDb,
      ownerId: 'account-42',
    });
    const syncB = new SqliteKeyringSyncProvider({
      database: sharedServerDb,
      ownerId: 'account-42',
    });
    const syncOtherUser = new SqliteKeyringSyncProvider({
      database: sharedServerDb,
      ownerId: 'account-99',
    });

    const managerA = new DrmKeyringManager({ store: storeA, syncProvider: syncA });
    const managerB = new DrmKeyringManager({ store: storeB, syncProvider: syncB });

    await managerA.load();
    await managerB.load();

    const created = await managerA.createKey({
      label: 'Desktop Vault Key',
      passphrase: 'desktop-key-passphrase',
      iterations: 10_000,
    });

    const enableA = await managerA.enableAndUnlockCloudSync({
      masterPassphrase: 'sqlite-cloud-master-secret',
      backupHint: 'Server SQLite',
      iterations: 10_000,
    });
    assert.equal(enableA.mergedCount, 1);
    assert.equal(enableA.pushed, true);

    // Ensure server backup table holds zero plaintext secrets
    const rawBackupRow = sharedServerDb
      .prepare('SELECT backup_json FROM drm_keyring_backups WHERE owner_id = ?')
      .get('account-42') as { backup_json: string } | undefined;
    assert.ok(rawBackupRow?.backup_json);
    assert.equal(rawBackupRow.backup_json.includes('desktop-key-passphrase'), false);
    assert.equal(rawBackupRow.backup_json.includes('sqlite-cloud-master-secret'), false);

    // Different ownerId cannot see account-42's backup
    assert.equal(await syncOtherUser.inspect(), null);
    assert.equal(await syncOtherUser.pull(), null);

    // Device B unlocks from shared SQLite server backup
    const enableB = await managerB.enableAndUnlockCloudSync({
      masterPassphrase: 'sqlite-cloud-master-secret',
      iterations: 10_000,
    });
    assert.equal(enableB.mergedCount, 1);
    assert.equal(managerB.getState().keys[0]?.keyId, created.keyId);

    // Delete remote backup via managerB
    await managerB.disableCloudSync(true);
    assert.equal(await syncA.inspect(), null);

    managerA.dispose();
    managerB.dispose();
  } finally {
    localDbA.close();
    localDbB.close();
    sharedServerDb.close();
  }
});

test('SqliteKeyringStore works with a custom async SqliteExecutor', async () => {
  const backingDb = new DatabaseSync(':memory:');
  try {
    const asyncExecutor: SqliteExecutor = {
      async exec(sql: string) {
        await Promise.resolve();
        backingDb.exec(sql);
      },
      async all<TRow>(sql: string, params: readonly SqliteParam[] = []) {
        await Promise.resolve();
        return backingDb.prepare(sql).all(...params) as TRow[];
      },
      async get<TRow>(sql: string, params: readonly SqliteParam[] = []) {
        await Promise.resolve();
        return backingDb.prepare(sql).get(...params) as TRow | undefined;
      },
      async run(sql: string, params: readonly SqliteParam[] = []) {
        await Promise.resolve();
        return backingDb.prepare(sql).run(...params);
      },
    };

    const store = new SqliteKeyringStore({
      executor: asyncExecutor,
      tableName: 'custom_keys_table',
    });

    const key = await createManagedDrmKey({
      label: 'Async SQLite Key',
      passphrase: 'async-sqlite-passphrase',
      iterations: 10_000,
    });
    await store.saveKey(key);
    assert.equal((await store.getKey(key.keyId))?.label, 'Async SQLite Key');
    assert.equal((await store.listKeys()).length, 1);
  } finally {
    backingDb.close();
  }
});
