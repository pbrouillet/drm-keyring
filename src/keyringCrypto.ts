import {
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_DRM_HINT_LENGTH,
  MAX_DRM_KEY_LABEL_LENGTH,
  MIN_DRM_PASSPHRASE_LENGTH,
} from './constants.js';
import { deriveKekFromPassphrase } from './crypto.js';
import { DrmAuthenticationError, DrmContainerFormatError } from './errors.js';
import type {
  CloudKeyringSessionHandle,
  DrmKeyringBackupHeader,
  DrmKeyringEncryptedBackup,
  DrmManagedKey,
  DrmProtocolProfile,
} from './types.js';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHexUpper,
  getWebCrypto,
  resolveProtocolProfile,
  toStrictArrayBuffer,
  wipeBytes,
} from './utils.js';

function buildKeyringBackupAadBytes(header: DrmKeyringBackupHeader): ArrayBuffer {
  const canonical = JSON.stringify({
    app: header.app,
    schemaVersion: header.schemaVersion,
    backupId: header.backupId,
    createdAt: header.createdAt,
    keyCount: header.keyCount,
    keyFingerprints: header.keyFingerprints,
  });
  return toStrictArrayBuffer(new TextEncoder().encode(canonical));
}

/**
 * Ensures at most one active key is marked `isDefault: true` (and promotes the newest active key
 * if none was marked default).
 */
export function normalizeDefaultDrmKeys(
  keys: DrmManagedKey[],
  preferredDefaultKeyId?: string
): DrmManagedKey[] {
  const sorted = [...keys].sort((a, b) => b.createdAt - a.createdAt);
  const activeKeys = sorted.filter((k) => k.status === 'active');
  if (activeKeys.length === 0) {
    return sorted.map((k) => (k.isDefault ? { ...k, isDefault: false } : k));
  }

  let chosenDefaultId =
    preferredDefaultKeyId && activeKeys.some((k) => k.keyId === preferredDefaultKeyId)
      ? preferredDefaultKeyId
      : activeKeys.find((k) => k.isDefault)?.keyId ?? activeKeys[0].keyId;

  return sorted.map((k) => {
    const shouldBeDefault = k.status === 'active' && k.keyId === chosenDefaultId;
    if (shouldBeDefault) {
      chosenDefaultId = k.keyId;
    }
    return k.isDefault === shouldBeDefault ? k : { ...k, isDefault: shouldBeDefault };
  });
}

/**
 * Merges or replaces local `DrmManagedKey` records with restored keys from cloud or portable backup.
 */
export function mergeRestoredDrmKeys(
  localKeys: DrmManagedKey[],
  restoredKeys: DrmManagedKey[],
  strategy: 'merge' | 'replace'
): DrmManagedKey[] {
  if (strategy === 'replace') {
    return normalizeDefaultDrmKeys(restoredKeys);
  }

  const byId = new Map<string, DrmManagedKey>();
  for (const local of localKeys) {
    byId.set(local.keyId, local);
  }
  for (const incoming of restoredKeys) {
    const existing = byId.get(incoming.keyId);
    if (!existing || incoming.updatedAt >= existing.updatedAt) {
      byId.set(incoming.keyId, incoming);
    }
  }

  const preferredDefault =
    localKeys.find((k) => k.status === 'active' && k.isDefault)?.keyId ??
    restoredKeys.find((k) => k.status === 'active' && k.isDefault)?.keyId;

  return normalizeDefaultDrmKeys(Array.from(byId.values()), preferredDefault);
}

/**
 * Encrypts a list of already-wrapped `DrmManagedKey` records into an authenticated outer
 * AES-256-GCM vault bundle suitable for Google Drive `appDataFolder` backup or `.nkey.json` export.
 */
export async function encryptDrmKeyringBackup(
  keys: DrmManagedKey[],
  backupPassphrase: string,
  options?: { backupHint?: string; iterations?: number; profile?: Partial<DrmProtocolProfile> }
): Promise<DrmKeyringEncryptedBackup> {
  if (keys.length === 0) {
    throw new Error('Create at least one DRM key before creating a keyring backup.');
  }
  if (!backupPassphrase || backupPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
    throw new Error(
      `Backup passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
    );
  }
  const cleanHint = (options?.backupHint ?? '').trim().slice(0, MAX_DRM_HINT_LENGTH);
  if (cleanHint && cleanHint.toLowerCase() === backupPassphrase.trim().toLowerCase()) {
    throw new Error('Never enter your backup passphrase inside the optional hint field.');
  }

  const profile = resolveProtocolProfile(options?.profile);
  const webCrypto = getWebCrypto();
  const iterations = Math.max(10_000, Math.round(options?.iterations ?? DEFAULT_PBKDF2_ITERATIONS));
  const salt = webCrypto.getRandomValues(new Uint8Array(16));
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const randSuffix = bytesToHexUpper(webCrypto.getRandomValues(new Uint8Array(4))).toLowerCase();
  const now = Date.now();
  const backupId = `kbkp_${now.toString(36)}_${randSuffix}`;
  const fingerprints = keys.map((k) => k.fingerprint);

  const header: DrmKeyringBackupHeader = {
    schemaVersion: 1,
    app: profile.keyringBackupAppId,
    backupId,
    createdAt: now,
    keyCount: keys.length,
    keyFingerprints: fingerprints,
    ...(cleanHint ? { backupHint: cleanHint } : {}),
  };

  const aad = buildKeyringBackupAadBytes(header);
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      exportedAt: now,
      keys,
    })
  );

  try {
    const backupKey = await deriveKekFromPassphrase(backupPassphrase, salt, iterations, [
      'encrypt',
    ]);
    const cipherBuf = await webCrypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toStrictArrayBuffer(iv),
        additionalData: aad,
      },
      backupKey,
      toStrictArrayBuffer(payloadBytes)
    );

    return {
      ...header,
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations,
      saltB64: bytesToBase64(salt),
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(new Uint8Array(cipherBuf)),
    };
  } finally {
    wipeBytes(payloadBytes);
  }
}

function sanitizeRestoredManagedKey(raw: unknown): DrmManagedKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<DrmManagedKey>;
  if (
    typeof obj.keyId !== 'string' ||
    !obj.keyId.trim() ||
    typeof obj.label !== 'string' ||
    !obj.label.trim() ||
    typeof obj.fingerprint !== 'string' ||
    !obj.fingerprint.trim() ||
    obj.kdf !== 'PBKDF2-SHA256' ||
    typeof obj.iterations !== 'number' ||
    obj.iterations < 10_000 ||
    typeof obj.saltB64 !== 'string' ||
    typeof obj.wrapIvB64 !== 'string' ||
    typeof obj.wrappedKeyB64 !== 'string'
  ) {
    return null;
  }

  return {
    keyId: obj.keyId.trim().slice(0, 80),
    label: obj.label.trim().slice(0, MAX_DRM_KEY_LABEL_LENGTH),
    fingerprint: obj.fingerprint.trim().slice(0, 32),
    generation:
      typeof obj.generation === 'number' && Number.isFinite(obj.generation) && obj.generation >= 1
        ? Math.round(obj.generation)
        : 1,
    status: obj.status === 'retired' ? 'retired' : 'active',
    isDefault: Boolean(obj.isDefault),
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    ...(typeof obj.rotatedAt === 'number' ? { rotatedAt: obj.rotatedAt } : {}),
    ...(typeof obj.rotatedFromKeyId === 'string' && obj.rotatedFromKeyId
      ? { rotatedFromKeyId: obj.rotatedFromKeyId.slice(0, 80) }
      : {}),
    ...(typeof obj.rotatedToKeyId === 'string' && obj.rotatedToKeyId
      ? { rotatedToKeyId: obj.rotatedToKeyId.slice(0, 80) }
      : {}),
    ...(typeof obj.keyHint === 'string' && obj.keyHint.trim()
      ? { keyHint: obj.keyHint.trim().slice(0, MAX_DRM_HINT_LENGTH) }
      : {}),
    kdf: 'PBKDF2-SHA256',
    iterations: Math.round(obj.iterations),
    saltB64: obj.saltB64,
    wrapIvB64: obj.wrapIvB64,
    wrappedKeyB64: obj.wrappedKeyB64,
  };
}

export function parseDrmKeyringBackupJson(
  rawJson: string,
  options?: { expectedAppId?: string; profile?: Partial<DrmProtocolProfile> }
): DrmKeyringEncryptedBackup {
  let parsed: Partial<DrmKeyringEncryptedBackup>;
  try {
    parsed = JSON.parse(rawJson) as Partial<DrmKeyringEncryptedBackup>;
  } catch {
    throw new DrmContainerFormatError('Invalid DRM keyring backup JSON file.');
  }

  const profile = resolveProtocolProfile(options?.profile);
  const expectedApp = options?.expectedAppId ?? profile.keyringBackupAppId;

  if (
    !parsed ||
    parsed.schemaVersion !== 1 ||
    parsed.app !== expectedApp ||
    parsed.cipher !== 'AES-256-GCM' ||
    parsed.kdf !== 'PBKDF2-SHA256' ||
    typeof parsed.backupId !== 'string' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.keyCount !== 'number' ||
    !Array.isArray(parsed.keyFingerprints) ||
    typeof parsed.iterations !== 'number' ||
    typeof parsed.saltB64 !== 'string' ||
    typeof parsed.ivB64 !== 'string' ||
    typeof parsed.ciphertextB64 !== 'string'
  ) {
    throw new DrmContainerFormatError('Malformed or unsupported DRM keyring backup envelope.');
  }

  return parsed as DrmKeyringEncryptedBackup;
}

async function decryptKeyringPayloadWithCryptoKey(
  backup: DrmKeyringEncryptedBackup,
  cryptoKey: CryptoKey
): Promise<DrmManagedKey[]> {
  const webCrypto = getWebCrypto();
  const aad = buildKeyringBackupAadBytes({
    schemaVersion: 1,
    app: backup.app,
    backupId: backup.backupId,
    createdAt: backup.createdAt,
    keyCount: backup.keyCount,
    keyFingerprints: backup.keyFingerprints,
  });

  let decryptedBuf: ArrayBuffer | null = null;
  try {
    try {
      decryptedBuf = await webCrypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toStrictArrayBuffer(base64ToBytes(backup.ivB64)),
          additionalData: aad,
        },
        cryptoKey,
        toStrictArrayBuffer(base64ToBytes(backup.ciphertextB64))
      );
    } catch {
      throw new DrmAuthenticationError(
        'Incorrect passphrase or tampered keyring backup file.'
      );
    }

    const decoded = JSON.parse(new TextDecoder().decode(decryptedBuf)) as {
      keys?: unknown[];
    };
    if (!decoded || !Array.isArray(decoded.keys)) {
      throw new DrmContainerFormatError('Decrypted keyring payload did not contain valid keys.');
    }

    const sanitized: DrmManagedKey[] = [];
    for (const item of decoded.keys) {
      const clean = sanitizeRestoredManagedKey(item);
      if (clean) sanitized.push(clean);
    }

    if (sanitized.length === 0) {
      throw new DrmContainerFormatError('No valid Managed DRM keys were found in this backup.');
    }

    return normalizeDefaultDrmKeys(sanitized);
  } finally {
    wipeBytes(decryptedBuf);
  }
}

/**
 * Verifies AES-256-GCM authenticity and decrypts an encrypted keyring backup bundle in RAM.
 */
export async function decryptDrmKeyringBackup(
  backup: DrmKeyringEncryptedBackup,
  backupPassphrase: string,
  options?: { expectedAppId?: string; profile?: Partial<DrmProtocolProfile> }
): Promise<DrmManagedKey[]> {
  if (!backupPassphrase) {
    throw new DrmAuthenticationError('Enter your backup passphrase to decrypt the keyring.');
  }
  const profile = resolveProtocolProfile(options?.profile);
  const expectedApp = options?.expectedAppId ?? profile.keyringBackupAppId;

  if (
    backup.schemaVersion !== 1 ||
    backup.app !== expectedApp ||
    backup.cipher !== 'AES-256-GCM' ||
    backup.kdf !== 'PBKDF2-SHA256'
  ) {
    throw new DrmContainerFormatError('Unsupported DRM keyring backup version.');
  }

  const backupKey = await deriveKekFromPassphrase(
    backupPassphrase,
    base64ToBytes(backup.saltB64),
    backup.iterations,
    ['decrypt']
  );

  return await decryptKeyringPayloadWithCryptoKey(backup, backupKey);
}

/**
 * Derives a non-extractable AES-256-GCM `CryptoKey` (`extractable: false`) from the user's
 * Master Passphrase in volatile RAM, wiping raw passphrase bytes immediately.
 * If `existingRemoteBackup` is present, authenticates and decrypts it in the same step.
 */
export async function unlockOrCreateCloudKeyringSession(
  masterPassphrase: string,
  existingRemoteBackup?: DrmKeyringEncryptedBackup | null,
  options?: {
    backupHint?: string;
    iterations?: number;
    expectedAppId?: string;
    profile?: Partial<DrmProtocolProfile>;
  }
): Promise<{ session: CloudKeyringSessionHandle; remoteKeys: DrmManagedKey[] }> {
  if (!masterPassphrase) {
    throw new DrmAuthenticationError('Enter your Cloud Keyring Master Passphrase.');
  }

  const profile = resolveProtocolProfile(options?.profile);
  const expectedApp = options?.expectedAppId ?? profile.keyringBackupAppId;

  const cleanHint = (
    options?.backupHint ??
    existingRemoteBackup?.backupHint ??
    ''
  )
    .trim()
    .slice(0, MAX_DRM_HINT_LENGTH);

  if (cleanHint && cleanHint.toLowerCase() === masterPassphrase.trim().toLowerCase()) {
    throw new Error('Never enter your Master Passphrase inside the optional hint field.');
  }

  if (existingRemoteBackup) {
    if (
      existingRemoteBackup.schemaVersion !== 1 ||
      existingRemoteBackup.app !== expectedApp ||
      existingRemoteBackup.cipher !== 'AES-256-GCM' ||
      existingRemoteBackup.kdf !== 'PBKDF2-SHA256'
    ) {
      throw new DrmContainerFormatError('Unsupported Cloud Keyring envelope version.');
    }

    const saltBytes = base64ToBytes(existingRemoteBackup.saltB64);
    const cryptoKey = await deriveKekFromPassphrase(
      masterPassphrase,
      saltBytes,
      existingRemoteBackup.iterations,
      ['encrypt', 'decrypt']
    );
    const remoteKeys = await decryptKeyringPayloadWithCryptoKey(existingRemoteBackup, cryptoKey);

    return {
      session: {
        cryptoKey,
        saltB64: existingRemoteBackup.saltB64,
        iterations: existingRemoteBackup.iterations,
        unlockedAt: Date.now(),
        ...(cleanHint ? { backupHint: cleanHint } : {}),
      },
      remoteKeys,
    };
  }

  if (masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
    throw new Error(
      `Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
    );
  }

  const webCrypto = getWebCrypto();
  const iterations = Math.max(10_000, Math.round(options?.iterations ?? DEFAULT_PBKDF2_ITERATIONS));
  const freshSalt = webCrypto.getRandomValues(new Uint8Array(16));
  const cryptoKey = await deriveKekFromPassphrase(masterPassphrase, freshSalt, iterations, [
    'encrypt',
    'decrypt',
  ]);

  return {
    session: {
      cryptoKey,
      saltB64: bytesToBase64(freshSalt),
      iterations,
      unlockedAt: Date.now(),
      ...(cleanHint ? { backupHint: cleanHint } : {}),
    },
    remoteKeys: [],
  };
}

/**
 * Seals the user's wrapped `DrmManagedKey` list into a `DrmKeyringEncryptedBackup` using an
 * active non-extractable `CloudKeyringSessionHandle` and a fresh random 96-bit AES-GCM IV.
 */
export async function encryptKeyringWithCloudSession(
  keys: DrmManagedKey[],
  session: CloudKeyringSessionHandle,
  options?: { backupHint?: string; profile?: Partial<DrmProtocolProfile> }
): Promise<DrmKeyringEncryptedBackup> {
  if (keys.length === 0) {
    throw new Error('Create at least one DRM key before syncing a Cloud Keyring bundle.');
  }

  const profile = resolveProtocolProfile(options?.profile);
  const webCrypto = getWebCrypto();
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const randSuffix = bytesToHexUpper(webCrypto.getRandomValues(new Uint8Array(4))).toLowerCase();
  const now = Date.now();
  const backupId = `kbkp_${now.toString(36)}_${randSuffix}`;
  const fingerprints = keys.map((k) => k.fingerprint);
  const cleanHint = (options?.backupHint ?? session.backupHint ?? '')
    .trim()
    .slice(0, MAX_DRM_HINT_LENGTH);

  const header: DrmKeyringBackupHeader = {
    schemaVersion: 1,
    app: profile.keyringBackupAppId,
    backupId,
    createdAt: now,
    keyCount: keys.length,
    keyFingerprints: fingerprints,
    ...(cleanHint ? { backupHint: cleanHint } : {}),
  };

  const aad = buildKeyringBackupAadBytes(header);
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      exportedAt: now,
      keys,
    })
  );

  try {
    const cipherBuf = await webCrypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toStrictArrayBuffer(iv),
        additionalData: aad,
      },
      session.cryptoKey,
      toStrictArrayBuffer(payloadBytes)
    );

    return {
      ...header,
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: session.iterations,
      saltB64: session.saltB64,
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(new Uint8Array(cipherBuf)),
    };
  } finally {
    wipeBytes(payloadBytes);
  }
}

/**
 * Verifies header AAD and decrypts a remote `DrmKeyringEncryptedBackup` using an active
 * non-extractable `CloudKeyringSessionHandle`.
 */
export async function decryptKeyringWithCloudSession(
  backup: DrmKeyringEncryptedBackup,
  session: CloudKeyringSessionHandle,
  options?: { expectedAppId?: string; profile?: Partial<DrmProtocolProfile> }
): Promise<DrmManagedKey[]> {
  const profile = resolveProtocolProfile(options?.profile);
  const expectedApp = options?.expectedAppId ?? profile.keyringBackupAppId;

  if (
    backup.schemaVersion !== 1 ||
    backup.app !== expectedApp ||
    backup.cipher !== 'AES-256-GCM' ||
    backup.kdf !== 'PBKDF2-SHA256'
  ) {
    throw new DrmContainerFormatError('Unsupported Cloud Keyring envelope version.');
  }

  if (backup.saltB64 !== session.saltB64 || backup.iterations !== session.iterations) {
    throw new DrmAuthenticationError(
      'Cloud Keyring Master Passphrase was changed on another device. Unlock again with the updated Master Passphrase.'
    );
  }

  return await decryptKeyringPayloadWithCryptoKey(backup, session.cryptoKey);
}
