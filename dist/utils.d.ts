import type { DrmProtocolProfile } from './types.js';
export declare function getWebCrypto(): Crypto;
export declare function resolveProtocolProfile(overrides?: Partial<DrmProtocolProfile>): DrmProtocolProfile;
/**
 * Overwrites a mutable ArrayBuffer or Uint8Array with zeros in place
 * so decrypted archive bytes and raw DEKs/KEKs do not linger in heap buffers.
 */
export declare function wipeBytes(target: ArrayBuffer | Uint8Array | null | undefined): void;
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function base64ToBytes(b64: string): Uint8Array;
export declare function bytesToHexUpper(bytes: Uint8Array): string;
export declare function bytesToHexLower(bytes: Uint8Array): string;
export declare function toStrictArrayBuffer(view: Uint8Array): ArrayBuffer;
/**
 * Computes a canonical lowercase 64-character hexadecimal SHA-256 digest via Web Crypto.
 */
export declare function computeSha256Hex(input: ArrayBuffer | Uint8Array): Promise<string>;
export declare function normalizeSha256Hex(raw?: unknown): string | undefined;
export declare function formatShortSha256(sha?: string | null, edgeChars?: number): string;
export declare function formatBytes(bytes: number): string;
//# sourceMappingURL=utils.d.ts.map