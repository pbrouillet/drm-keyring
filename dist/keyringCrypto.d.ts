import type { CloudKeyringSessionHandle, DrmKeyringEncryptedBackup, DrmManagedKey, DrmProtocolProfile } from './types.js';
/**
 * Ensures at most one active key is marked `isDefault: true` (and promotes the newest active key
 * if none was marked default).
 */
export declare function normalizeDefaultDrmKeys(keys: DrmManagedKey[], preferredDefaultKeyId?: string): DrmManagedKey[];
/**
 * Merges or replaces local `DrmManagedKey` records with restored keys from cloud or portable backup.
 */
export declare function mergeRestoredDrmKeys(localKeys: DrmManagedKey[], restoredKeys: DrmManagedKey[], strategy: 'merge' | 'replace'): DrmManagedKey[];
/**
 * Encrypts a list of already-wrapped `DrmManagedKey` records into an authenticated outer
 * AES-256-GCM vault bundle suitable for Google Drive `appDataFolder` backup or `.nkey.json` export.
 */
export declare function encryptDrmKeyringBackup(keys: DrmManagedKey[], backupPassphrase: string, options?: {
    backupHint?: string;
    iterations?: number;
    profile?: Partial<DrmProtocolProfile>;
}): Promise<DrmKeyringEncryptedBackup>;
export declare function parseDrmKeyringBackupJson(rawJson: string, options?: {
    expectedAppId?: string;
    profile?: Partial<DrmProtocolProfile>;
}): DrmKeyringEncryptedBackup;
/**
 * Verifies AES-256-GCM authenticity and decrypts an encrypted keyring backup bundle in RAM.
 */
export declare function decryptDrmKeyringBackup(backup: DrmKeyringEncryptedBackup, backupPassphrase: string, options?: {
    expectedAppId?: string;
    profile?: Partial<DrmProtocolProfile>;
}): Promise<DrmManagedKey[]>;
/**
 * Derives a non-extractable AES-256-GCM `CryptoKey` (`extractable: false`) from the user's
 * Master Passphrase in volatile RAM, wiping raw passphrase bytes immediately.
 * If `existingRemoteBackup` is present, authenticates and decrypts it in the same step.
 */
export declare function unlockOrCreateCloudKeyringSession(masterPassphrase: string, existingRemoteBackup?: DrmKeyringEncryptedBackup | null, options?: {
    backupHint?: string;
    iterations?: number;
    expectedAppId?: string;
    profile?: Partial<DrmProtocolProfile>;
}): Promise<{
    session: CloudKeyringSessionHandle;
    remoteKeys: DrmManagedKey[];
}>;
/**
 * Seals the user's wrapped `DrmManagedKey` list into a `DrmKeyringEncryptedBackup` using an
 * active non-extractable `CloudKeyringSessionHandle` and a fresh random 96-bit AES-GCM IV.
 */
export declare function encryptKeyringWithCloudSession(keys: DrmManagedKey[], session: CloudKeyringSessionHandle, options?: {
    backupHint?: string;
    profile?: Partial<DrmProtocolProfile>;
}): Promise<DrmKeyringEncryptedBackup>;
/**
 * Verifies header AAD and decrypts a remote `DrmKeyringEncryptedBackup` using an active
 * non-extractable `CloudKeyringSessionHandle`.
 */
export declare function decryptKeyringWithCloudSession(backup: DrmKeyringEncryptedBackup, session: CloudKeyringSessionHandle, options?: {
    expectedAppId?: string;
    profile?: Partial<DrmProtocolProfile>;
}): Promise<DrmManagedKey[]>;
//# sourceMappingURL=keyringCrypto.d.ts.map