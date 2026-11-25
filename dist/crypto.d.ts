import type { CreateManagedDrmKeyOptions, DrmAuthSource, DrmAuthTarget, DrmManagedKey, DrmProtocolProfile, EncryptDrmOptions, PersonalDrmEnvelope, RotateManagedDrmKeyOptions } from './types.js';
export declare function deriveKekFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]): Promise<CryptoKey>;
/**
 * Generates a fresh 256-bit random Managed DRM Key and wraps it immediately under a
 * PBKDF2-SHA256 + AES-256-GCM passphrase-derived key. Raw key material is wiped before return.
 */
export declare function createManagedDrmKey(options: CreateManagedDrmKeyOptions): Promise<DrmManagedKey>;
export declare function verifyManagedDrmKeyPassphrase(keyRecord: DrmManagedKey, passphrase: string, profileOverrides?: Partial<DrmProtocolProfile>): Promise<void>;
/**
 * Verifies ownership of `existingKey` with `currentPassphrase`, retires it, and generates
 * a successor `DrmManagedKey` (`generation + 1`) with fresh 256-bit key material.
 */
export declare function rotateManagedDrmKey(existingKey: DrmManagedKey, currentPassphrase: string, options?: RotateManagedDrmKeyOptions): Promise<{
    retiredKey: DrmManagedKey;
    newKey: DrmManagedKey;
}>;
/**
 * Encrypts a binary payload using two-tier Envelope Encryption:
 * 1. PBKDF2-HMAC-SHA256 (210,000 iterations + 16-byte random salt) derives a non-extractable 256-bit KEK.
 * 2. A fresh random 256-bit DEK is generated per item and wrapped with AES-256-GCM under the KEK.
 * 3. Plaintext bytes are encrypted with AES-256-GCM under the DEK with AAD binding format & size.
 */
export declare function encryptWithPersonalDrm<TInnerFormat extends string = string>(plaintext: ArrayBuffer, passphrase: string, options: EncryptDrmOptions<TInnerFormat>): Promise<{
    envelope: PersonalDrmEnvelope<TInnerFormat>;
    ciphertext: ArrayBuffer;
}>;
export declare const encryptBookWithPersonalDrm: typeof encryptWithPersonalDrm;
/**
 * Encrypts a binary payload using a Managed DRM Key (`managed-key-v1` envelope scheme).
 * Unwraps the Managed Key's 256-bit KEK in RAM, wraps a fresh per-item 256-bit DEK, and wipes all keys.
 */
export declare function encryptWithManagedDrmKey<TInnerFormat extends string = string>(plaintext: ArrayBuffer, keyRecord: DrmManagedKey, keyPassphrase: string, options: EncryptDrmOptions<TInnerFormat>): Promise<{
    envelope: PersonalDrmEnvelope<TInnerFormat>;
    ciphertext: ArrayBuffer;
}>;
export declare const encryptBookWithManagedDrmKey: typeof encryptWithManagedDrmKey;
/**
 * Decrypts a Personal DRM archive strictly in volatile RAM using a standalone passphrase.
 */
export declare function decryptWithPersonalDrm<TInnerFormat extends string = string>(ciphertext: ArrayBuffer, envelope: PersonalDrmEnvelope<TInnerFormat>, passphrase: string, options?: {
    profile?: Partial<DrmProtocolProfile>;
}): Promise<ArrayBuffer>;
export declare const decryptBookWithPersonalDrm: typeof decryptWithPersonalDrm;
/**
 * Decrypts a `managed-key-v1` DRM volume strictly in volatile RAM using its Managed DRM Key record.
 */
export declare function decryptWithManagedDrmKey<TInnerFormat extends string = string>(ciphertext: ArrayBuffer, envelope: PersonalDrmEnvelope<TInnerFormat>, keyRecord: DrmManagedKey, keyPassphrase: string, options?: {
    profile?: Partial<DrmProtocolProfile>;
}): Promise<ArrayBuffer>;
export declare const decryptBookWithManagedDrmKey: typeof decryptWithManagedDrmKey;
/**
 * Rotates a DRM-protected item's key or passphrase:
 * - By default (`deepReencryptPayload: false`), unwraps ONLY the 32-byte per-item DEK in RAM and
 *   re-wraps it under `targetAuth` with a fresh 96-bit IV (never exposing plaintext in RAM).
 * - When `deepReencryptPayload: true`, also decrypts the archive in RAM, generates a brand-new
 *   per-item DEK + content IV, re-encrypts the payload, and wipes all intermediate buffers.
 */
export declare function rewrapDrmKey<TInnerFormat extends string = string>(ciphertext: ArrayBuffer, currentEnvelope: PersonalDrmEnvelope<TInnerFormat>, sourceAuth: DrmAuthSource, targetAuth: DrmAuthTarget, options?: {
    deepReencryptPayload?: boolean;
    sealCoverWhenLocked?: boolean;
    profile?: Partial<DrmProtocolProfile>;
}): Promise<{
    envelope: PersonalDrmEnvelope<TInnerFormat>;
    ciphertext: ArrayBuffer;
}>;
export declare const rewrapBookDrmKey: typeof rewrapDrmKey;
//# sourceMappingURL=crypto.d.ts.map