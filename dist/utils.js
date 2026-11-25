import { DEFAULT_DRM_PROTOCOL_PROFILE, SHA256_HEX_MAX_LEN, SHA256_HEX_PATTERN, } from './constants.js';
export function getWebCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
        return globalThis.crypto;
    }
    throw new Error('Web Crypto API (crypto.subtle) is unavailable in this environment.');
}
export function resolveProtocolProfile(overrides) {
    if (!overrides) {
        return DEFAULT_DRM_PROTOCOL_PROFILE;
    }
    return {
        drmAadAppId: overrides.drmAadAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.drmAadAppId,
        managedKeyAadAppId: overrides.managedKeyAadAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.managedKeyAadAppId,
        keyringBackupAppId: overrides.keyringBackupAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.keyringBackupAppId,
        keyFingerprintDomain: overrides.keyFingerprintDomain ?? DEFAULT_DRM_PROTOCOL_PROFILE.keyFingerprintDomain,
    };
}
/**
 * Overwrites a mutable ArrayBuffer or Uint8Array with zeros in place
 * so decrypted archive bytes and raw DEKs/KEKs do not linger in heap buffers.
 */
export function wipeBytes(target) {
    if (!target)
        return;
    try {
        if (target instanceof Uint8Array) {
            target.fill(0);
        }
        else if (target.byteLength > 0) {
            new Uint8Array(target).fill(0);
        }
    }
    catch {
        // Ignore detached ArrayBuffers (e.g. transferred to Web Worker)
    }
}
export function bytesToBase64(bytes) {
    if (typeof btoa === 'function') {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
}
export function base64ToBytes(b64) {
    if (typeof atob === 'function') {
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            out[i] = binary.charCodeAt(i);
        }
        return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
}
export function bytesToHexUpper(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0').toUpperCase();
    }
    return out;
}
export function bytesToHexLower(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}
export function toStrictArrayBuffer(view) {
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
}
/**
 * Computes a canonical lowercase 64-character hexadecimal SHA-256 digest via Web Crypto.
 */
export async function computeSha256Hex(input) {
    const webCrypto = getWebCrypto();
    const buffer = input instanceof Uint8Array
        ? input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
            ? input.buffer
            : toStrictArrayBuffer(input)
        : input;
    const digest = await webCrypto.subtle.digest('SHA-256', buffer);
    return bytesToHexLower(new Uint8Array(digest));
}
export function normalizeSha256Hex(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length !== SHA256_HEX_MAX_LEN)
        return undefined;
    return SHA256_HEX_PATTERN.test(trimmed) ? trimmed : undefined;
}
export function formatShortSha256(sha, edgeChars = 8) {
    const normalized = normalizeSha256Hex(sha);
    if (!normalized)
        return '—';
    const safeEdge = Math.max(4, Math.min(16, Math.floor(edgeChars)));
    if (normalized.length <= safeEdge * 2 + 1)
        return normalized;
    return `${normalized.slice(0, safeEdge)}…${normalized.slice(-safeEdge)}`;
}
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0)
        return '0 B';
    if (bytes < 1024)
        return `${Math.round(bytes)} B`;
    const kb = bytes / 1024;
    if (kb < 1024)
        return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024)
        return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
}
//# sourceMappingURL=utils.js.map