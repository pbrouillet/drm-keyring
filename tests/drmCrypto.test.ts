import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSha256Hex,
  createManagedDrmKey,
  decryptWithManagedDrmKey,
  decryptWithPersonalDrm,
  DrmAuthenticationError,
  encryptWithManagedDrmKey,
  encryptWithPersonalDrm,
  rewrapDrmKey,
  rotateManagedDrmKey,
  verifyManagedDrmKeyPassphrase,
  wipeBytes,
} from '../src/index.js';

function makeSampleBytes(size = 256): Uint8Array {
  const bytes = new Uint8Array(size);
  // Start with ZIP magic bytes PK\x03\x04 to verify ciphertext hides it
  bytes[0] = 0x50;
  bytes[1] = 0x4b;
  bytes[2] = 0x03;
  bytes[3] = 0x04;
  for (let i = 4; i < size; i++) {
    bytes[i] = (i * 31 + 7) & 0xff;
  }
  return bytes;
}

test('Personal DRM encrypts with PBKDF2-SHA256 + AES-256-GCM, verifies AAD & ciphertext integrity, and wipes RAM buffers', async () => {
  const original = makeSampleBytes(512);
  const plaintextBuffer = original.slice().buffer;
  const expectedSha = await computeSha256Hex(original);

  const { envelope, ciphertext } = await encryptWithPersonalDrm(
    plaintextBuffer,
    'midnight-observatory-key',
    {
      innerFormat: 'CBZ',
      originalFileName: 'Astral_Cartographer_01.cbz',
      sealCoverWhenLocked: true,
      keyHint: 'Observatory passphrase',
      iterations: 12_000,
    }
  );

  assert.equal(envelope.version, 1);
  assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.equal(envelope.innerFormat, 'CBZ');
  assert.equal(envelope.plaintextSizeBytes, original.byteLength);
  assert.equal(envelope.sealCoverWhenLocked, true);
  assert.equal(envelope.keyHint, 'Observatory passphrase');
  assert.equal(envelope.plaintextSha256, expectedSha);

  // Ciphertext must not start with ZIP magic bytes
  assert.notDeepEqual(Array.from(new Uint8Array(ciphertext, 0, 4)), [0x50, 0x4b, 0x03, 0x04]);

  wipeBytes(plaintextBuffer);
  assert.ok(new Uint8Array(plaintextBuffer).every((b) => b === 0));

  const decrypted = await decryptWithPersonalDrm(
    ciphertext,
    envelope,
    'midnight-observatory-key'
  );
  assert.deepEqual(Array.from(new Uint8Array(decrypted)), Array.from(original));

  await assert.rejects(
    () => decryptWithPersonalDrm(ciphertext, envelope, 'wrong-passphrase-attempt'),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  // Tampered AAD metadata
  await assert.rejects(
    () =>
      decryptWithPersonalDrm(
        ciphertext,
        { ...envelope, innerFormat: 'PDF' },
        'midnight-observatory-key'
      ),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  // Tampered ciphertext byte
  const tampered = ciphertext.slice(0);
  const view = new Uint8Array(tampered);
  view[view.length - 1] ^= 0xff;
  await assert.rejects(
    () => decryptWithPersonalDrm(tampered, envelope, 'midnight-observatory-key'),
    (err: unknown) => err instanceof DrmAuthenticationError
  );
});

test('Managed DRM Key lifecycle: create, verify, hint validation, encrypt/decrypt, rotate (fast & deep), and standalone conversion', async () => {
  await assert.rejects(
    () =>
      createManagedDrmKey({
        label: 'Invalid Hint Key',
        passphrase: 'same-secret-passphrase',
        keyHint: 'same-secret-passphrase',
        iterations: 10_000,
      }),
    /Never enter your actual passphrase/
  );

  const original = makeSampleBytes(384);
  const keyV1 = await createManagedDrmKey({
    label: 'Primary Comic Vault',
    passphrase: 'harbour-lantern-pass-v1',
    keyHint: 'Harbour lantern v1',
    isDefault: true,
    iterations: 10_000,
  });

  assert.equal(keyV1.status, 'active');
  assert.equal(keyV1.generation, 1);
  assert.equal(keyV1.isDefault, true);
  assert.match(keyV1.fingerprint, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

  await verifyManagedDrmKeyPassphrase(keyV1, 'harbour-lantern-pass-v1');
  await assert.rejects(
    () => verifyManagedDrmKeyPassphrase(keyV1, 'wrong-pass'),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  const encryptedV1 = await encryptWithManagedDrmKey(
    original.slice().buffer,
    keyV1,
    'harbour-lantern-pass-v1',
    {
      innerFormat: 'CBZ',
      originalFileName: 'Sunken_Pier_02.cbz',
      sealCoverWhenLocked: true,
    }
  );

  assert.equal(encryptedV1.envelope.kekScheme, 'managed-key-v1');
  assert.equal(encryptedV1.envelope.keyId, keyV1.keyId);
  assert.equal(encryptedV1.envelope.keyFingerprint, keyV1.fingerprint);

  const decryptedV1 = await decryptWithManagedDrmKey(
    encryptedV1.ciphertext,
    encryptedV1.envelope,
    keyV1,
    'harbour-lantern-pass-v1'
  );
  assert.deepEqual(Array.from(new Uint8Array(decryptedV1)), Array.from(original));

  await assert.rejects(
    () =>
      decryptWithPersonalDrm(
        encryptedV1.ciphertext,
        encryptedV1.envelope,
        'harbour-lantern-pass-v1'
      ),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  // Rotate v1 -> v2
  const { retiredKey, newKey: keyV2 } = await rotateManagedDrmKey(
    keyV1,
    'harbour-lantern-pass-v1',
    {
      newPassphrase: 'summit-observatory-pass-v2',
      newLabel: 'Primary Comic Vault',
      newKeyHint: 'Summit observatory v2',
      iterations: 10_000,
    }
  );

  assert.equal(retiredKey.status, 'retired');
  assert.equal(retiredKey.isDefault, false);
  assert.equal(retiredKey.rotatedToKeyId, keyV2.keyId);
  assert.equal(keyV2.status, 'active');
  assert.equal(keyV2.generation, 2);
  assert.equal(keyV2.rotatedFromKeyId, keyV1.keyId);

  // Fast DEK re-wrap
  const fastRewrapped = await rewrapDrmKey(
    encryptedV1.ciphertext,
    encryptedV1.envelope,
    { mode: 'managed', keyRecord: retiredKey, passphrase: 'harbour-lantern-pass-v1' },
    { mode: 'managed', keyRecord: keyV2, passphrase: 'summit-observatory-pass-v2' },
    { deepReencryptPayload: false }
  );

  assert.equal(fastRewrapped.envelope.keyId, keyV2.keyId);
  assert.equal(fastRewrapped.envelope.contentIvB64, encryptedV1.envelope.contentIvB64);
  assert.notEqual(fastRewrapped.envelope.wrappedDekB64, encryptedV1.envelope.wrappedDekB64);

  await assert.rejects(
    () =>
      decryptWithManagedDrmKey(
        fastRewrapped.ciphertext,
        fastRewrapped.envelope,
        retiredKey,
        'harbour-lantern-pass-v1'
      ),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  const unlockedFast = await decryptWithManagedDrmKey(
    fastRewrapped.ciphertext,
    fastRewrapped.envelope,
    keyV2,
    'summit-observatory-pass-v2'
  );
  assert.deepEqual(Array.from(new Uint8Array(unlockedFast)), Array.from(original));

  // Deep payload re-encryption + switch to standalone passphrase
  const deepToStandalone = await rewrapDrmKey(
    fastRewrapped.ciphertext,
    fastRewrapped.envelope,
    { mode: 'managed', keyRecord: keyV2, passphrase: 'summit-observatory-pass-v2' },
    {
      mode: 'passphrase',
      passphrase: 'standalone-folio-secret',
      keyHint: 'Standalone folio',
      iterations: 10_000,
    },
    { deepReencryptPayload: true }
  );

  assert.equal(deepToStandalone.envelope.kekScheme, undefined);
  assert.notEqual(
    deepToStandalone.envelope.contentIvB64,
    fastRewrapped.envelope.contentIvB64
  );

  const unlockedStandalone = await decryptWithPersonalDrm(
    deepToStandalone.ciphertext,
    deepToStandalone.envelope,
    'standalone-folio-secret'
  );
  assert.deepEqual(Array.from(new Uint8Array(unlockedStandalone)), Array.from(original));
});

test('Custom DrmProtocolProfile isolates domain AAD and key fingerprints cleanly', async () => {
  const profileA = {
    drmAadAppId: 'custom-app-a-drm',
    managedKeyAadAppId: 'custom-app-a-mkey',
    keyFingerprintDomain: 'custom-app-a-fp:',
  };
  const profileB = {
    drmAadAppId: 'custom-app-b-drm',
    managedKeyAadAppId: 'custom-app-b-mkey',
    keyFingerprintDomain: 'custom-app-b-fp:',
  };

  const payload = makeSampleBytes(128).slice().buffer;
  const keyA = await createManagedDrmKey({
    label: 'Profile A Key',
    passphrase: 'profile-a-passphrase',
    iterations: 10_000,
    profile: profileA,
  });

  await assert.rejects(
    () => verifyManagedDrmKeyPassphrase(keyA, 'profile-a-passphrase', profileB),
    (err: unknown) => err instanceof DrmAuthenticationError
  );

  const sealed = await encryptWithManagedDrmKey(payload, keyA, 'profile-a-passphrase', {
    innerFormat: 'ZIP',
    originalFileName: 'bundle.zip',
    profile: profileA,
  });

  const unlockedA = await decryptWithManagedDrmKey(
    sealed.ciphertext,
    sealed.envelope,
    keyA,
    'profile-a-passphrase',
    { profile: profileA }
  );
  assert.equal(unlockedA.byteLength, 128);
});
