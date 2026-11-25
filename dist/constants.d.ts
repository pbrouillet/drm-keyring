import type { DrmProtocolProfile } from './types.js';
export declare const DEFAULT_PBKDF2_ITERATIONS = 210000;
export declare const MIN_DRM_PASSPHRASE_LENGTH = 8;
export declare const MAX_DRM_HINT_LENGTH = 80;
export declare const MAX_DRM_KEY_LABEL_LENGTH = 64;
export declare const NDRM_MAGIC: Uint8Array<ArrayBuffer>;
export declare const NDRM_CONTAINER_VERSION = 1;
export declare const MAX_NDRM_HEADER_BYTES: number;
export declare const NDRM_HEADER_PEEK_MAX_BYTES = 65536;
export declare const SHA256_HEX_MAX_LEN = 64;
export declare const SHA256_HEX_PATTERN: RegExp;
export declare const DEFAULT_KEYRING_FILENAME = "nocturne-drm-keyring-v1.enc.json";
export declare const DEFAULT_DRM_PROTOCOL_PROFILE: Readonly<DrmProtocolProfile>;
//# sourceMappingURL=constants.d.ts.map