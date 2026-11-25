import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DrmAuthenticationError,
  DrmKeyringManager,
  MemoryCloudKeyringSyncProvider,
  MemoryKeyringStore,
  VolatileKeyringCache,
} from '../src/index.js';

test('DrmKeyringManager manages keys, rotation with onBeforeCommit + volatile migration, portable backups, and multi-device E2EE cloud sync', async () => {
  const sharedRemote = new MemoryCloudKeyringSyncProvider();

  const storeA = new MemoryKeyringStore();
  const volatileA = new VolatileKeyringCache();
  let configChangeEvents = 0;

  const managerA = new DrmKeyringManager({
    store: storeA,
    syncProvider: sharedRemote,
    volatileCache: volatileA,
    exportFilePrefix: 'nocturne-drm-keyring',
    onCloudSyncConfigChange: () => {
      configChangeEvents += 1;
    },
  });

  let stateChanges = 0;
  const unsub = managerA.subscribe(() => {
    stateChanges += 1;
  });

  await managerA.load();
  assert.equal(managerA.getState().isLoaded, true);
  assert.equal(managerA.getState().keys.length, 0);

  // Create two keys
  const key1 = await managerA.createKey({
    label: 'Studio Alpha',
    passphrase: 'alpha-vault-passphrase',
    isDefault: true,
    iterations: 10_000,
  });
  const key2 = await managerA.createKey({
    label: 'Studio Beta',
    passphrase: 'beta-vault-passphrase',
    isDefault: false,
    iterations: 10_000,
  });
  assert.equal(managerA.getState().keys.length, 2);
  assert.equal(managerA.findKeyForEnvelope({ keyId: key1.keyId })?.keyId, key1.keyId);

  // Set default key
  await managerA.setDefaultKey(key2.keyId);
  assert.equal(
    managerA.getState().keys.find((k) => k.keyId === key2.keyId)?.isDefault,
    true
  );

  // Cache volatile passphrase for key1, then rotate key1 with onBeforeCommit hook
  managerA.cacheVolatilePassphrase(key1.keyId, 'alpha-vault-passphrase');
  assert.equal(managerA.getState().hasActiveVolatileKey, true);

  let commitHookRan = false;
  const { retiredKey, newKey } = await managerA.rotateKey(
    key1.keyId,
    'alpha-vault-passphrase',
    {
      newPassphrase: 'alpha-rotated-passphrase',
      newLabel: 'Studio Alpha v2',
      iterations: 10_000,
      onBeforeCommit: async (ctx) => {
        commitHookRan = true;
        assert.equal(ctx.retiredKey.status, 'retired');
        assert.equal(ctx.newKey.generation, 2);
      },
    }
  );
  assert.equal(commitHookRan, true);
  assert.equal(retiredKey.status, 'retired');
  assert.equal(newKey.generation, 2);
  assert.equal(managerA.getState().keys.length, 3);

  // Volatile cache migrated from old key1 to newKey
  const volatileCandidates = managerA.resolveVolatileCandidates(newKey.keyId);
  assert.equal(volatileCandidates[0]?.cacheKey, newKey.keyId);
  assert.equal(volatileCandidates[0]?.passphrase, 'alpha-rotated-passphrase');

  // Portable .nkey.json export
  const exported = await managerA.exportEncryptedBackup(
    'portable-backup-passphrase',
    'Safe drawer',
    10_000
  );
  assert.match(exported.fileName, /^nocturne-drm-keyring-\d{4}-\d{2}-\d{2}\.nkey\.json$/);
  assert.equal(exported.backup.keyCount, 3);

  // Enable & unlock Cloud Keyring on Device A (pushes 3 keys)
  const enableA = await managerA.enableAndUnlockCloudSync({
    masterPassphrase: 'cloud-master-passphrase-1',
    backupHint: 'Studio notebook',
    iterations: 10_000,
  });
  assert.equal(enableA.mergedCount, 3);
  assert.equal(enableA.pushed, true);
  assert.equal(managerA.getState().isCloudSessionUnlocked, true);
  assert.equal(configChangeEvents, 1);

  // Device B unlocks the remote Cloud Keyring, creates a new key, and auto-pushes
  const managerB = new DrmKeyringManager({
    store: new MemoryKeyringStore(),
    syncProvider: sharedRemote,
  });
  await managerB.load();
  const enableB = await managerB.enableAndUnlockCloudSync({
    masterPassphrase: 'cloud-master-passphrase-1',
    iterations: 10_000,
  });
  assert.equal(enableB.mergedCount, 3);

  const key3 = await managerB.createKey({
    label: 'Device B Key',
    passphrase: 'device-b-key-secret',
    iterations: 10_000,
  });
  // Allow async auto-push microtask to settle
  await new Promise((r) => setTimeout(r, 50));

  // Device A syncs and receives Device B's new key
  const syncA = await managerA.syncCloudKeyringNow();
  assert.equal(syncA.mergedCount, 4);
  assert.ok(managerA.getState().keys.some((k) => k.keyId === key3.keyId));

  // Device B rotates the Master Passphrase -> Device A's stale session locks cleanly
  await managerB.rotateCloudMasterPassphrase({
    newMasterPassphrase: 'cloud-master-passphrase-2',
    newHint: 'Rotated',
    iterations: 10_000,
  });
  await assert.rejects(
    () => managerA.syncCloudKeyringNow(),
    (err: unknown) => err instanceof DrmAuthenticationError
  );
  assert.equal(managerA.getState().isCloudSessionUnlocked, false);

  // Import portable .nkey.json with replace strategy onto a fresh manager
  const managerC = new DrmKeyringManager({
    store: new MemoryKeyringStore(),
    syncProvider: sharedRemote,
  });
  await managerC.load();
  const imported = await managerC.importEncryptedBackup(
    exported.json,
    'portable-backup-passphrase',
    'replace'
  );
  assert.equal(imported.restoredCount, 3);
  assert.equal(imported.totalKeyCount, 3);

  // Delete key & disable cloud sync with remote delete
  await managerB.deleteKey(key3.keyId);
  assert.equal(managerB.getState().keys.length, 3);
  await managerB.disableCloudSync(true);
  assert.equal(managerB.getState().isCloudSyncEnabled, false);
  assert.equal(await sharedRemote.inspect(), null);

  assert.ok(stateChanges > 0);
  unsub();
  managerA.dispose();
  managerB.dispose();
  managerC.dispose();
});

test('DrmKeyringManager lazy-prunes expired volatile entries and does not migrate an expired rotated key while another key is active', async () => {
  const volatile = new VolatileKeyringCache({
    isSessionActive: () => false,
  });
  const manager = new DrmKeyringManager({
    store: new MemoryKeyringStore(),
    volatileCache: volatile,
  });
  await manager.load();

  const expiredKey = await manager.createKey({
    label: 'Expiring Key',
    passphrase: 'expiring-key-passphrase',
    iterations: 10_000,
  });
  const activeKey = await manager.createKey({
    label: 'Active Key',
    passphrase: 'active-key-passphrase',
    iterations: 10_000,
  });

  // Seed expiredKey with an already-expired entry, and activeKey with a live entry
  const past = Date.now() - 60_000;
  volatile.entries.set(expiredKey.keyId, {
    passphrase: 'expiring-key-passphrase',
    durationMs: 1_000,
    expiresAt: past,
  });
  manager.cacheVolatilePassphrase(activeKey.keyId, 'active-key-passphrase', 60_000);
  assert.equal(manager.getState().hasActiveVolatileKey, true);

  // Rotating expiredKey must NOT migrate its expired volatile passphrase even though activeKey is live
  const { newKey } = await manager.rotateKey(expiredKey.keyId, 'expiring-key-passphrase', {
    newPassphrase: 'new-rotated-passphrase',
    iterations: 10_000,
  });
  assert.equal(volatile.get(expiredKey.keyId), undefined);
  assert.equal(volatile.get(newKey.keyId), undefined);
  assert.equal(volatile.get(activeKey.keyId)?.passphrase, 'active-key-passphrase');

  // Expiring activeKey and lazily checking resolveVolatileCandidates updates hasActiveVolatileKey
  volatile.entries.set(activeKey.keyId, {
    passphrase: 'active-key-passphrase',
    durationMs: 1_000,
    expiresAt: Date.now() - 10,
  });
  assert.deepEqual(manager.resolveVolatileCandidates(activeKey.keyId), []);
  assert.equal(manager.getState().hasActiveVolatileKey, false);

  manager.dispose();
});
