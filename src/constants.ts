import type { DrmProtocolProfile } from './types.js';

export const DEFAULT_PBKDF2_ITERATIONS = 210_000;
export const MIN_DRM_PASSPHRASE_LENGTH = 8;
export const MAX_DRM_HINT_LENGTH = 80;
export const MAX_DRM_KEY_LABEL_LENGTH = 64;

export const NDRM_MAGIC = new Uint8Array([0x4e, 0x44, 0x52, 0x4d]); // ASCII "NDRM"
export const NDRM_CONTAINER_VERSION = 1;
export const MAX_NDRM_HEADER_BYTES = 64 * 1024;
export const NDRM_HEADER_PEEK_MAX_BYTES = 65_536;

export const SHA256_HEX_MAX_LEN = 64;
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const DEFAULT_KEYRING_FILENAME = 'nocturne-drm-keyring-v1.enc.json';

export const DEFAULT_DRM_PROTOCOL_PROFILE: Readonly<DrmProtocolProfile> = {
  drmAadAppId: 'nocturne-personal-drm',
  managedKeyAadAppId: 'nocturne-drm-managed-key',
  keyringBackupAppId: 'nocturne-drm-keyring',
  keyFingerprintDomain: 'nocturne-drm-key-fp-v1:',
};
