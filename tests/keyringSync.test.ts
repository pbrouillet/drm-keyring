import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagedDrmKey,
  decryptDrmKeyringBackup,
  decryptKeyringWithCloudSession,
  DrmAuthenticationError,
  encryptDrmKeyringBackup,
  encryptKeyringWithCloudSession,
  KeyringSyncApiNotEnabledError,
  KeyringSyncAuthExpiredError,
  KeyringSyncPermissionScopeError,
  mergeRestoredDrmKeys,
  normalizeDefaultDrmKeys,
  parseDrmKeyringBackupJson,
  unlockOrCreateCloudKeyringSession,
} from '../src/index.js';
import {
  classifyKeyringDriveApiError,
  GoogleDriveKeyringSyncProvider,
} from '../src/sync/googleDrive.js';

test('Encrypted DRM Keyring Backup & Restore double-encrypts wrapped keys, detects AAD header tampering, and merges or replaces cleanly', async () => {
  const keyA = await createManagedDrmKey({
    label: 'Franco-Belgian Vault',
    passphrase: 'atelier-alpha-passphrase',
    keyHint: 'Alpha hint',
    isDefault: true,
    iterations: 10_000,
  });
  const keyB = await createManagedDrmKey({
    label: 'Alpine Manga Vault',
    passphrase: 'kurobe-beta-passphrase',
    keyHint: 'Beta hint',
    isDefault: false,
    iterations: 10_000,
  });

  const localRing = normalizeDefaultDrmKeys([keyA, keyB], keyA.keyId);
  const encryptedBackup = await encryptDrmKeyringBackup(
    localRing,
    'outer-google-drive-backup-secret',
    {
      backupHint: 'Drive vault secret',
      iterations: 10_000,
    }
  );

  assert.equal(encryptedBackup.schemaVersion, 1);
  assert.equal(encryptedBackup.app, 'nocturne-drm-keyring');
  assert.equal(encryptedBackup.keyCount, 2);

  const serialized = JSON.stringify(encryptedBackup);
  assert.ok(!serialized.includes('atelier-alpha-passphrase'));
  assert.ok(!serialized.includes(keyA.wrappedKeyB64));

  const parsedBackup = parseDrmKeyringBackupJson(serialized);
  const restoredKeys = await decryptDrmKeyringBackup(
    parsedBackup,
    'outer-google-drive-backup-secret'
  );
  assert.equal(restoredKeys.length, 2);

  await assert.rejects(
    () => decryptDrmKeyringBackup(parsedBackup, 'wrong-backup-passphrase'),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  await assert.rejects(
    () =>
      decryptDrmKeyringBackup(
        { ...parsedBackup, keyCount: 99 },
        'outer-google-drive-backup-secret'
      ),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  const localOnlyKey = await createManagedDrmKey({
    label: 'Device Local Key',
    passphrase: 'device-local-passphrase',
    isDefault: true,
    iterations: 10_000,
  });

  const mergedRing = mergeRestoredDrmKeys([localOnlyKey], restoredKeys, 'merge');
  assert.equal(mergedRing.length, 3);
  assert.equal(mergedRing.filter((k) => k.isDefault).length, 1);

  const replacedRing = mergeRestoredDrmKeys([localOnlyKey], restoredKeys, 'replace');
  assert.equal(replacedRing.length, 2);
  assert.ok(!replacedRing.some((k) => k.keyId === localOnlyKey.keyId));
  assert.equal(replacedRing.filter((k) => k.isDefault).length, 1);
});

test('Cloud Keyring E2EE session derives non-extractable CryptoKey, rotates IV per push, syncs across devices, and detects passphrase rotation', async () => {
  const keyDeviceA = await createManagedDrmKey({
    label: 'Device A Vault Key',
    passphrase: 'device-a-inner-kek-pass',
    keyHint: 'Device A inner',
    isDefault: true,
    iterations: 10_000,
  });

  await assert.rejects(
    () =>
      unlockOrCreateCloudKeyringSession('astral-master-passphrase-99', null, {
        backupHint: 'astral-master-passphrase-99',
        iterations: 10_000,
      }),
    /Never enter your Master Passphrase/
  );

  const initA = await unlockOrCreateCloudKeyringSession('astral-master-passphrase-99', null, {
    backupHint: 'Astral brass notebook',
    iterations: 10_000,
  });
  assert.equal(initA.remoteKeys.length, 0);
  assert.equal(initA.session.cryptoKey.extractable, false);

  const push1 = await encryptKeyringWithCloudSession([keyDeviceA], initA.session);
  const push2 = await encryptKeyringWithCloudSession([keyDeviceA], initA.session);
  assert.notEqual(push1.ivB64, push2.ivB64);
  assert.equal(push1.saltB64, push2.saltB64);

  await assert.rejects(
    () => unlockOrCreateCloudKeyringSession('wrong-master-passphrase', push2),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  const keyDeviceB = await createManagedDrmKey({
    label: 'Device B Manga Key',
    passphrase: 'device-b-inner-kek-pass',
    isDefault: false,
    iterations: 10_000,
  });
  const unlockB = await unlockOrCreateCloudKeyringSession('astral-master-passphrase-99', push2);
  assert.equal(unlockB.remoteKeys.length, 1);

  const mergedOnB = mergeRestoredDrmKeys([keyDeviceB], unlockB.remoteKeys, 'merge');
  const pushFromB = await encryptKeyringWithCloudSession(mergedOnB, unlockB.session);
  const pulledOnA = await decryptKeyringWithCloudSession(pushFromB, initA.session);
  assert.equal(pulledOnA.length, 2);

  // Rotating Master Passphrase generates new salt; stale session rejects
  const rotatedB = await unlockOrCreateCloudKeyringSession('rotated-master-passphrase-2027', null, {
    backupHint: 'Rotated 2027',
    iterations: 10_000,
  });
  const resealedFromB = await encryptKeyringWithCloudSession(mergedOnB, rotatedB.session);
  await assert.rejects(
    () => decryptKeyringWithCloudSession(resealedFromB, initA.session),
    (err: unknown) => err instanceof DrmAuthenticationError
  );
});

test('GoogleDriveKeyringSyncProvider inspect/push/pull/delete and HTTP error classification', async () => {
  assert.ok(classifyKeyringDriveApiError(401, '{}') instanceof KeyringSyncAuthExpiredError);
  assert.ok(
    classifyKeyringDriveApiError(
      403,
      JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } })
    ) instanceof KeyringSyncPermissionScopeError
  );
  assert.ok(
    classifyKeyringDriveApiError(
      403,
      JSON.stringify({ error: { errors: [{ reason: 'accessNotConfigured' }] } })
    ) instanceof KeyringSyncApiNotEnabledError
  );

  let storedFileJson: string | null = null;
  let storedFileId = 'drive-file-1';
  let authExpiredCount = 0;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    if (headers.get('Authorization') === 'Bearer expired-token') {
      return new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), {
        status: 401,
      });
    }

    if (url.includes('/drive/v3/files?') && method === 'GET') {
      return new Response(
        JSON.stringify({
          files: storedFileJson
            ? [
                {
                  id: storedFileId,
                  modifiedTime: '2026-11-25T10:00:00Z',
                  size: String(storedFileJson.length),
                },
              ]
            : [],
        }),
        { status: 200 }
      );
    }

    if (url.includes('/upload/drive/v3/files?uploadType=multipart') && method === 'POST') {
      const bodyStr = String(init?.body ?? '');
      const jsonMatch = bodyStr.match(/Content-Type: application\/json\r\n\r\n([\s\S]*?)\r\n--/);
      assert.ok(jsonMatch);
      storedFileJson = jsonMatch[1];
      return new Response(
        JSON.stringify({
          id: storedFileId,
          modifiedTime: '2026-11-25T10:01:00Z',
          size: String(storedFileJson.length),
        }),
        { status: 200 }
      );
    }

    if (url.includes(`/upload/drive/v3/files/${storedFileId}?uploadType=media`) && method === 'PATCH') {
      storedFileJson = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          id: storedFileId,
          modifiedTime: '2026-11-25T10:02:00Z',
          size: String(storedFileJson.length),
        }),
        { status: 200 }
      );
    }

    if (url.includes(`/drive/v3/files/${storedFileId}?alt=media`) && method === 'GET') {
      return new Response(storedFileJson ?? '', { status: storedFileJson ? 200 : 404 });
    }

    if (url.includes(`/drive/v3/files/${storedFileId}`) && method === 'DELETE') {
      storedFileJson = null;
      return new Response(null, { status: 204 });
    }

    return new Response('Not found', { status: 404 });
  };

  let activeToken = 'valid-token';
  const provider = new GoogleDriveKeyringSyncProvider({
    getAccessToken: async () => activeToken,
    fetchImpl: mockFetch,
    onAuthExpired: () => {
      authExpiredCount += 1;
    },
  });

  assert.equal(await provider.inspect(), null);

  const key = await createManagedDrmKey({
    label: 'Drive Sync Key',
    passphrase: 'drive-sync-key-secret',
    iterations: 10_000,
  });
  const backup = await encryptDrmKeyringBackup([key], 'outer-drive-secret', {
    iterations: 10_000,
  });

  // First push creates multipart file
  const createdSummary = await provider.push(backup);
  assert.equal(createdSummary.fileId, storedFileId);
  assert.equal(createdSummary.header?.keyCount, 1);

  // Second push updates via PATCH
  const updatedSummary = await provider.push(backup);
  assert.equal(updatedSummary.fileId, storedFileId);

  const inspected = await provider.inspect();
  assert.equal(inspected?.header?.backupId, backup.backupId);

  const pulled = await provider.pull();
  assert.equal(pulled?.backupId, backup.backupId);

  await provider.delete();
  assert.equal(await provider.inspect(), null);

  // Expired token triggers onAuthExpired callback
  activeToken = 'expired-token';
  await assert.rejects(
    () => provider.inspect(),
    (err: unknown) => err instanceof KeyringSyncAuthExpiredError
  );
  assert.equal(authExpiredCount, 1);
});
