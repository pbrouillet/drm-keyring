export type DrmKekScheme = 'passphrase-pbkdf2' | 'managed-key-v1';

export type DrmKeyStatus = 'active' | 'retired';

export interface DrmProtocolProfile {
  drmAadAppId: string;
  managedKeyAadAppId: string;
  keyringBackupAppId: string;
  keyFingerprintDomain: string;
}

export interface PersonalDrmEnvelope<TInnerFormat extends string = string> {
  version: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltB64: string;
  kekIvB64: string;
  wrappedDekB64: string;
  contentIvB64: string;
  innerFormat: TInnerFormat;
  originalFileName: string;
  plaintextSizeBytes: number;
  sealCoverWhenLocked: boolean;
  keyHint?: string;
  kekScheme?: DrmKekScheme;
  keyId?: string;
  keyLabel?: string;
  keyFingerprint?: string;
  plaintextSha256?: string;
}

export interface DrmManagedKey {
  keyId: string;
  label: string;
  fingerprint: string;
  generation: number;
  status: DrmKeyStatus;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  rotatedAt?: number;
  rotatedFromKeyId?: string;
  rotatedToKeyId?: string;
  keyHint?: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltB64: string;
  wrapIvB64: string;
  wrappedKeyB64: string;
}

export interface DrmKeyringBackupHeader {
  schemaVersion: 1;
  app: string;
  backupId: string;
  createdAt: number;
  keyCount: number;
  keyFingerprints: string[];
  backupHint?: string;
}

export interface DrmKeyringEncryptedBackup extends DrmKeyringBackupHeader {
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

export interface RemoteKeyringSummary {
  fileId: string;
  modifiedTime: string;
  sizeBytes: number;
  header?: DrmKeyringBackupHeader;
}

export type RemoteDriveKeyringSummary = RemoteKeyringSummary;

export type CloudKeyringSyncStatus = 'disabled' | 'locked' | 'syncing' | 'synced' | 'error';

/**
 * Volatile in-memory session handle for Opt-In Cloud Keyring E2EE sync.
 * Holds ONLY a non-extractable Web Crypto `CryptoKey` (`extractable === false`); the user's
 * Master Passphrase is wiped immediately after PBKDF2 derivation and is NEVER stored anywhere.
 */
export interface CloudKeyringSessionHandle {
  readonly cryptoKey: CryptoKey;
  readonly saltB64: string;
  readonly iterations: number;
  readonly unlockedAt: number;
  readonly backupHint?: string;
}

export interface CreateManagedDrmKeyOptions {
  label: string;
  passphrase: string;
  keyHint?: string;
  isDefault?: boolean;
  generation?: number;
  rotatedFromKeyId?: string;
  iterations?: number;
  profile?: Partial<DrmProtocolProfile>;
}

export interface RotateManagedDrmKeyOptions {
  newPassphrase?: string;
  newLabel?: string;
  newKeyHint?: string;
  iterations?: number;
  profile?: Partial<DrmProtocolProfile>;
}

export interface EncryptDrmOptions<TInnerFormat extends string = string> {
  innerFormat: TInnerFormat;
  originalFileName: string;
  sealCoverWhenLocked?: boolean;
  keyHint?: string;
  iterations?: number;
  profile?: Partial<DrmProtocolProfile>;
}

export type EncryptBookDrmOptions<TInnerFormat extends string = string> =
  EncryptDrmOptions<TInnerFormat>;

export type DrmAuthSource =
  | { mode: 'passphrase'; passphrase: string }
  | { mode: 'managed'; keyRecord: DrmManagedKey; passphrase: string };

export type DrmBookAuthSource = DrmAuthSource;

export type DrmAuthTarget =
  | { mode: 'passphrase'; passphrase: string; keyHint?: string; iterations?: number }
  | { mode: 'managed'; keyRecord: DrmManagedKey; passphrase: string };

export type DrmBookAuthTarget = DrmAuthTarget;

export interface DrmProtectedItem<TInnerFormat extends string = string> {
  id: string;
  title: string;
  format: TInnerFormat;
  sizeBytes: number;
  source?: string;
  drm?: PersonalDrmEnvelope<TInnerFormat>;
}
