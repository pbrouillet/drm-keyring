import { DEFAULT_PBKDF2_ITERATIONS, MAX_DRM_HINT_LENGTH, MAX_DRM_KEY_LABEL_LENGTH, MIN_DRM_PASSPHRASE_LENGTH, } from './constants.js';
import { DrmAuthenticationError, DrmContainerFormatError } from './errors.js';
import { base64ToBytes, bytesToBase64, bytesToHexUpper, computeSha256Hex, getWebCrypto, resolveProtocolProfile, toStrictArrayBuffer, wipeBytes, } from './utils.js';
function buildDrmAadBytes(meta, profile) {
    const canonical = JSON.stringify({
        app: profile.drmAadAppId,
        version: meta.version,
        cipher: meta.cipher,
        innerFormat: meta.innerFormat,
        plaintextSizeBytes: meta.plaintextSizeBytes,
    });
    return toStrictArrayBuffer(new TextEncoder().encode(canonical));
}
function buildManagedKeyWrapAadBytes(meta, profile) {
    const canonical = JSON.stringify({
        app: profile.managedKeyAadAppId,
        version: 1,
        keyId: meta.keyId,
        fingerprint: meta.fingerprint,
    });
    return toStrictArrayBuffer(new TextEncoder().encode(canonical));
}
async function computeRawKeyFingerprint(rawKeyBytes, profile) {
    const webCrypto = getWebCrypto();
    const prefixBytes = new TextEncoder().encode(profile.keyFingerprintDomain);
    const combined = new Uint8Array(prefixBytes.length + rawKeyBytes.length);
    try {
        combined.set(prefixBytes, 0);
        combined.set(rawKeyBytes, prefixBytes.length);
        const digest = await webCrypto.subtle.digest('SHA-256', combined.buffer);
        const hex16 = bytesToHexUpper(new Uint8Array(digest, 0, 8));
        return `${hex16.slice(0, 4)}-${hex16.slice(4, 8)}-${hex16.slice(8, 12)}-${hex16.slice(12, 16)}`;
    }
    finally {
        wipeBytes(combined);
    }
}
export async function deriveKekFromPassphrase(passphrase, salt, iterations, usage) {
    const webCrypto = getWebCrypto();
    const passphraseBytes = new TextEncoder().encode(passphrase);
    try {
        const baseKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(passphraseBytes), 'PBKDF2', false, ['deriveKey']);
        return await webCrypto.subtle.deriveKey({
            name: 'PBKDF2',
            salt: toStrictArrayBuffer(salt),
            iterations,
            hash: 'SHA-256',
        }, baseKey, { name: 'AES-GCM', length: 256 }, false, usage);
    }
    finally {
        wipeBytes(passphraseBytes);
    }
}
/**
 * Generates a fresh 256-bit random Managed DRM Key and wraps it immediately under a
 * PBKDF2-SHA256 + AES-256-GCM passphrase-derived key. Raw key material is wiped before return.
 */
export async function createManagedDrmKey(options) {
    const cleanLabel = options.label.trim().slice(0, MAX_DRM_KEY_LABEL_LENGTH);
    if (!cleanLabel) {
        throw new Error('Enter a descriptive label for your DRM key.');
    }
    if (!options.passphrase || options.passphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
        throw new Error(`Key passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
    }
    const cleanHint = (options.keyHint ?? '').trim().slice(0, MAX_DRM_HINT_LENGTH);
    if (cleanHint && cleanHint.toLowerCase() === options.passphrase.trim().toLowerCase()) {
        throw new Error('Never enter your actual passphrase inside the optional hint field.');
    }
    const profile = resolveProtocolProfile(options.profile);
    const webCrypto = getWebCrypto();
    const iterations = Math.max(10_000, Math.round(options.iterations ?? DEFAULT_PBKDF2_ITERATIONS));
    const rawKek = webCrypto.getRandomValues(new Uint8Array(32));
    const salt = webCrypto.getRandomValues(new Uint8Array(16));
    const wrapIv = webCrypto.getRandomValues(new Uint8Array(12));
    const randSuffix = bytesToHexUpper(webCrypto.getRandomValues(new Uint8Array(4))).toLowerCase();
    const now = Date.now();
    const keyId = `drmk_${now.toString(36)}_${randSuffix}`;
    try {
        const fingerprint = await computeRawKeyFingerprint(rawKek, profile);
        const wrapAad = buildManagedKeyWrapAadBytes({ keyId, fingerprint }, profile);
        const passWrapKey = await deriveKekFromPassphrase(options.passphrase, salt, iterations, [
            'encrypt',
        ]);
        const wrappedKeyBuf = await webCrypto.subtle.encrypt({
            name: 'AES-GCM',
            iv: toStrictArrayBuffer(wrapIv),
            additionalData: wrapAad,
        }, passWrapKey, toStrictArrayBuffer(rawKek));
        return {
            keyId,
            label: cleanLabel,
            fingerprint,
            generation: Math.max(1, Math.round(options.generation ?? 1)),
            status: 'active',
            isDefault: options.isDefault ?? true,
            createdAt: now,
            updatedAt: now,
            ...(options.rotatedFromKeyId ? { rotatedFromKeyId: options.rotatedFromKeyId } : {}),
            ...(cleanHint ? { keyHint: cleanHint } : {}),
            kdf: 'PBKDF2-SHA256',
            iterations,
            saltB64: bytesToBase64(salt),
            wrapIvB64: bytesToBase64(wrapIv),
            wrappedKeyB64: bytesToBase64(new Uint8Array(wrappedKeyBuf)),
        };
    }
    finally {
        wipeBytes(rawKek);
    }
}
/**
 * Unwraps a Managed DRM Key's 32-byte raw KEK strictly in volatile RAM and verifies its SHA-256 fingerprint.
 * Caller MUST wipeBytes(returnedArray) inside a finally block.
 */
async function unwrapManagedDrmKeyBytes(keyRecord, passphrase, profileOverrides) {
    if (!passphrase) {
        throw new DrmAuthenticationError('Enter the passphrase for this DRM key.');
    }
    const profile = resolveProtocolProfile(profileOverrides);
    const webCrypto = getWebCrypto();
    const salt = base64ToBytes(keyRecord.saltB64);
    const wrapIv = base64ToBytes(keyRecord.wrapIvB64);
    const wrappedKey = base64ToBytes(keyRecord.wrappedKeyB64);
    const wrapAad = buildManagedKeyWrapAadBytes({
        keyId: keyRecord.keyId,
        fingerprint: keyRecord.fingerprint,
    }, profile);
    const passWrapKey = await deriveKekFromPassphrase(passphrase, salt, keyRecord.iterations, ['decrypt']);
    let rawBuffer;
    try {
        rawBuffer = await webCrypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: toStrictArrayBuffer(wrapIv),
            additionalData: wrapAad,
        }, passWrapKey, toStrictArrayBuffer(wrappedKey));
    }
    catch {
        throw new DrmAuthenticationError(`Incorrect passphrase for DRM key "${keyRecord.label}" (${keyRecord.fingerprint}).`);
    }
    const rawBytes = new Uint8Array(rawBuffer);
    if (rawBytes.byteLength !== 32) {
        wipeBytes(rawBytes);
        throw new DrmContainerFormatError('Invalid unwrapped DRM key length.');
    }
    const computedFp = await computeRawKeyFingerprint(rawBytes, profile);
    if (computedFp !== keyRecord.fingerprint) {
        wipeBytes(rawBytes);
        throw new DrmAuthenticationError('DRM key fingerprint integrity verification failed.');
    }
    return rawBytes;
}
export async function verifyManagedDrmKeyPassphrase(keyRecord, passphrase, profileOverrides) {
    const raw = await unwrapManagedDrmKeyBytes(keyRecord, passphrase, profileOverrides);
    wipeBytes(raw);
}
/**
 * Verifies ownership of `existingKey` with `currentPassphrase`, retires it, and generates
 * a successor `DrmManagedKey` (`generation + 1`) with fresh 256-bit key material.
 */
export async function rotateManagedDrmKey(existingKey, currentPassphrase, options) {
    await verifyManagedDrmKeyPassphrase(existingKey, currentPassphrase, options?.profile);
    const effectivePassphrase = options?.newPassphrase && options.newPassphrase.length > 0
        ? options.newPassphrase
        : currentPassphrase;
    const effectiveLabel = (options?.newLabel ?? existingKey.label)
        .trim()
        .slice(0, MAX_DRM_KEY_LABEL_LENGTH);
    const effectiveHint = options?.newKeyHint !== undefined ? options.newKeyHint : existingKey.keyHint;
    const newKey = await createManagedDrmKey({
        label: effectiveLabel || existingKey.label,
        passphrase: effectivePassphrase,
        keyHint: effectiveHint,
        isDefault: existingKey.isDefault,
        generation: (existingKey.generation || 1) + 1,
        rotatedFromKeyId: existingKey.keyId,
        iterations: options?.iterations ?? existingKey.iterations,
        profile: options?.profile,
    });
    const now = newKey.createdAt;
    const retiredKey = {
        ...existingKey,
        status: 'retired',
        isDefault: false,
        updatedAt: now,
        rotatedAt: now,
        rotatedToKeyId: newKey.keyId,
    };
    return { retiredKey, newKey };
}
/**
 * Encrypts a binary payload using two-tier Envelope Encryption:
 * 1. PBKDF2-HMAC-SHA256 (210,000 iterations + 16-byte random salt) derives a non-extractable 256-bit KEK.
 * 2. A fresh random 256-bit DEK is generated per item and wrapped with AES-256-GCM under the KEK.
 * 3. Plaintext bytes are encrypted with AES-256-GCM under the DEK with AAD binding format & size.
 */
export async function encryptWithPersonalDrm(plaintext, passphrase, options) {
    if (!passphrase || passphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
        throw new Error(`Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
    }
    const profile = resolveProtocolProfile(options.profile);
    const webCrypto = getWebCrypto();
    const iterations = Math.max(10_000, Math.round(options.iterations ?? DEFAULT_PBKDF2_ITERATIONS));
    const salt = webCrypto.getRandomValues(new Uint8Array(16));
    const kekIv = webCrypto.getRandomValues(new Uint8Array(12));
    const contentIv = webCrypto.getRandomValues(new Uint8Array(12));
    const rawDek = webCrypto.getRandomValues(new Uint8Array(32));
    const aadBytes = buildDrmAadBytes({
        version: 1,
        cipher: 'AES-256-GCM',
        innerFormat: options.innerFormat,
        plaintextSizeBytes: plaintext.byteLength,
    }, profile);
    try {
        const kek = await deriveKekFromPassphrase(passphrase, salt, iterations, ['encrypt']);
        const wrappedDekBuffer = await webCrypto.subtle.encrypt({
            name: 'AES-GCM',
            iv: toStrictArrayBuffer(kekIv),
            additionalData: aadBytes,
        }, kek, toStrictArrayBuffer(rawDek));
        const dekCryptoKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(rawDek), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const [plaintextSha256, ciphertext] = await Promise.all([
            computeSha256Hex(plaintext),
            webCrypto.subtle.encrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(contentIv),
                additionalData: aadBytes,
            }, dekCryptoKey, plaintext),
        ]);
        const cleanHint = (options.keyHint ?? '').trim().slice(0, MAX_DRM_HINT_LENGTH);
        const envelope = {
            version: 1,
            cipher: 'AES-256-GCM',
            kdf: 'PBKDF2-SHA256',
            iterations,
            saltB64: bytesToBase64(salt),
            kekIvB64: bytesToBase64(kekIv),
            wrappedDekB64: bytesToBase64(new Uint8Array(wrappedDekBuffer)),
            contentIvB64: bytesToBase64(contentIv),
            innerFormat: options.innerFormat,
            originalFileName: options.originalFileName.trim().slice(0, 240) || 'volume.cbz',
            plaintextSizeBytes: plaintext.byteLength,
            sealCoverWhenLocked: options.sealCoverWhenLocked ?? false,
            ...(cleanHint ? { keyHint: cleanHint } : {}),
            plaintextSha256,
        };
        return { envelope, ciphertext };
    }
    finally {
        wipeBytes(rawDek);
    }
}
export const encryptBookWithPersonalDrm = encryptWithPersonalDrm;
/**
 * Encrypts a binary payload using a Managed DRM Key (`managed-key-v1` envelope scheme).
 * Unwraps the Managed Key's 256-bit KEK in RAM, wraps a fresh per-item 256-bit DEK, and wipes all keys.
 */
export async function encryptWithManagedDrmKey(plaintext, keyRecord, keyPassphrase, options) {
    const profile = resolveProtocolProfile(options.profile);
    const webCrypto = getWebCrypto();
    const rawKek = await unwrapManagedDrmKeyBytes(keyRecord, keyPassphrase, options.profile);
    const kekIv = webCrypto.getRandomValues(new Uint8Array(12));
    const contentIv = webCrypto.getRandomValues(new Uint8Array(12));
    const rawDek = webCrypto.getRandomValues(new Uint8Array(32));
    const aadBytes = buildDrmAadBytes({
        version: 1,
        cipher: 'AES-256-GCM',
        innerFormat: options.innerFormat,
        plaintextSizeBytes: plaintext.byteLength,
    }, profile);
    try {
        const kekCryptoKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(rawKek), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const wrappedDekBuffer = await webCrypto.subtle.encrypt({
            name: 'AES-GCM',
            iv: toStrictArrayBuffer(kekIv),
            additionalData: aadBytes,
        }, kekCryptoKey, toStrictArrayBuffer(rawDek));
        const dekCryptoKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(rawDek), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const [plaintextSha256, ciphertext] = await Promise.all([
            computeSha256Hex(plaintext),
            webCrypto.subtle.encrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(contentIv),
                additionalData: aadBytes,
            }, dekCryptoKey, plaintext),
        ]);
        const effectiveHint = (options.keyHint ?? keyRecord.keyHint ?? '')
            .trim()
            .slice(0, MAX_DRM_HINT_LENGTH);
        const envelope = {
            version: 1,
            cipher: 'AES-256-GCM',
            kdf: 'PBKDF2-SHA256',
            iterations: keyRecord.iterations,
            saltB64: keyRecord.saltB64,
            kekIvB64: bytesToBase64(kekIv),
            wrappedDekB64: bytesToBase64(new Uint8Array(wrappedDekBuffer)),
            contentIvB64: bytesToBase64(contentIv),
            innerFormat: options.innerFormat,
            originalFileName: options.originalFileName.trim().slice(0, 240) || 'volume.cbz',
            plaintextSizeBytes: plaintext.byteLength,
            sealCoverWhenLocked: options.sealCoverWhenLocked ?? false,
            ...(effectiveHint ? { keyHint: effectiveHint } : {}),
            kekScheme: 'managed-key-v1',
            keyId: keyRecord.keyId,
            keyLabel: keyRecord.label,
            keyFingerprint: keyRecord.fingerprint,
            plaintextSha256,
        };
        return { envelope, ciphertext };
    }
    finally {
        wipeBytes(rawKek);
        wipeBytes(rawDek);
    }
}
export const encryptBookWithManagedDrmKey = encryptWithManagedDrmKey;
/**
 * Decrypts a Personal DRM archive strictly in volatile RAM using a standalone passphrase.
 */
export async function decryptWithPersonalDrm(ciphertext, envelope, passphrase, options) {
    if (!passphrase) {
        throw new DrmAuthenticationError('Passphrase is required to unlock this volume.');
    }
    if (envelope.version !== 1 ||
        envelope.cipher !== 'AES-256-GCM' ||
        envelope.kdf !== 'PBKDF2-SHA256') {
        throw new DrmContainerFormatError('Unsupported Personal DRM cipher or version.');
    }
    if (envelope.kekScheme === 'managed-key-v1') {
        throw new DrmAuthenticationError(`This volume is bound to Managed DRM Key "${envelope.keyLabel || envelope.keyFingerprint || envelope.keyId}". Restore or select that key in DRM Key Vault to unlock.`);
    }
    const profile = resolveProtocolProfile(options?.profile);
    const webCrypto = getWebCrypto();
    const salt = base64ToBytes(envelope.saltB64);
    const kekIv = base64ToBytes(envelope.kekIvB64);
    const wrappedDek = base64ToBytes(envelope.wrappedDekB64);
    const contentIv = base64ToBytes(envelope.contentIvB64);
    const aadBytes = buildDrmAadBytes({
        version: envelope.version,
        cipher: envelope.cipher,
        innerFormat: envelope.innerFormat,
        plaintextSizeBytes: envelope.plaintextSizeBytes,
    }, profile);
    const kek = await deriveKekFromPassphrase(passphrase, salt, envelope.iterations, ['decrypt']);
    let rawDekBuffer = null;
    try {
        try {
            rawDekBuffer = await webCrypto.subtle.decrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(kekIv),
                additionalData: aadBytes,
            }, kek, toStrictArrayBuffer(wrappedDek));
        }
        catch {
            throw new DrmAuthenticationError('Incorrect passphrase. Could not unwrap the volume encryption key.');
        }
        const dekCryptoKey = await webCrypto.subtle.importKey('raw', rawDekBuffer, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        try {
            return await webCrypto.subtle.decrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(contentIv),
                additionalData: aadBytes,
            }, dekCryptoKey, ciphertext);
        }
        catch {
            throw new DrmAuthenticationError('Encrypted archive failed AES-GCM integrity authentication.');
        }
    }
    finally {
        wipeBytes(rawDekBuffer);
    }
}
export const decryptBookWithPersonalDrm = decryptWithPersonalDrm;
/**
 * Decrypts a `managed-key-v1` DRM volume strictly in volatile RAM using its Managed DRM Key record.
 */
export async function decryptWithManagedDrmKey(ciphertext, envelope, keyRecord, keyPassphrase, options) {
    if (envelope.version !== 1 ||
        envelope.cipher !== 'AES-256-GCM' ||
        envelope.kdf !== 'PBKDF2-SHA256') {
        throw new DrmContainerFormatError('Unsupported Personal DRM cipher or version.');
    }
    const profile = resolveProtocolProfile(options?.profile);
    const webCrypto = getWebCrypto();
    const rawKek = await unwrapManagedDrmKeyBytes(keyRecord, keyPassphrase, options?.profile);
    const kekIv = base64ToBytes(envelope.kekIvB64);
    const wrappedDek = base64ToBytes(envelope.wrappedDekB64);
    const contentIv = base64ToBytes(envelope.contentIvB64);
    const aadBytes = buildDrmAadBytes({
        version: envelope.version,
        cipher: envelope.cipher,
        innerFormat: envelope.innerFormat,
        plaintextSizeBytes: envelope.plaintextSizeBytes,
    }, profile);
    let rawDekBuffer = null;
    try {
        const kekCryptoKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(rawKek), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        try {
            rawDekBuffer = await webCrypto.subtle.decrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(kekIv),
                additionalData: aadBytes,
            }, kekCryptoKey, toStrictArrayBuffer(wrappedDek));
        }
        catch {
            throw new DrmAuthenticationError(`Managed DRM key "${keyRecord.label}" (${keyRecord.fingerprint}) does not match this volume's encryption envelope.`);
        }
        const dekCryptoKey = await webCrypto.subtle.importKey('raw', rawDekBuffer, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        try {
            return await webCrypto.subtle.decrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(contentIv),
                additionalData: aadBytes,
            }, dekCryptoKey, ciphertext);
        }
        catch {
            throw new DrmAuthenticationError('Encrypted archive failed AES-GCM integrity authentication.');
        }
    }
    finally {
        wipeBytes(rawKek);
        wipeBytes(rawDekBuffer);
    }
}
export const decryptBookWithManagedDrmKey = decryptWithManagedDrmKey;
/**
 * Rotates a DRM-protected item's key or passphrase:
 * - By default (`deepReencryptPayload: false`), unwraps ONLY the 32-byte per-item DEK in RAM and
 *   re-wraps it under `targetAuth` with a fresh 96-bit IV (never exposing plaintext in RAM).
 * - When `deepReencryptPayload: true`, also decrypts the archive in RAM, generates a brand-new
 *   per-item DEK + content IV, re-encrypts the payload, and wipes all intermediate buffers.
 */
export async function rewrapDrmKey(ciphertext, currentEnvelope, sourceAuth, targetAuth, options) {
    const profile = resolveProtocolProfile(options?.profile);
    const webCrypto = getWebCrypto();
    const aadBytes = buildDrmAadBytes({
        version: currentEnvelope.version,
        cipher: currentEnvelope.cipher,
        innerFormat: currentEnvelope.innerFormat,
        plaintextSizeBytes: currentEnvelope.plaintextSizeBytes,
    }, profile);
    let sourceRawKek = null;
    let targetRawKek = null;
    let unwrappedDekBuf = null;
    let freshDekBytes = null;
    let plaintextBuf = null;
    try {
        // 1. Unwrap existing 256-bit DEK using sourceAuth
        let sourceKekCrypto;
        if (sourceAuth.mode === 'managed') {
            sourceRawKek = await unwrapManagedDrmKeyBytes(sourceAuth.keyRecord, sourceAuth.passphrase, options?.profile);
            sourceKekCrypto = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(sourceRawKek), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        }
        else {
            if (!sourceAuth.passphrase) {
                throw new DrmAuthenticationError('Enter the current passphrase to rotate this volume.');
            }
            sourceKekCrypto = await deriveKekFromPassphrase(sourceAuth.passphrase, base64ToBytes(currentEnvelope.saltB64), currentEnvelope.iterations, ['decrypt']);
        }
        try {
            unwrappedDekBuf = await webCrypto.subtle.decrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(base64ToBytes(currentEnvelope.kekIvB64)),
                additionalData: aadBytes,
            }, sourceKekCrypto, toStrictArrayBuffer(base64ToBytes(currentEnvelope.wrappedDekB64)));
        }
        catch {
            throw new DrmAuthenticationError('Current passphrase or source DRM key could not unlock this volume for rotation.');
        }
        // 2. Determine DEK + Ciphertext (fast envelope re-wrap vs deep payload re-encryption)
        let activeDekBytes = new Uint8Array(unwrappedDekBuf);
        let nextCiphertext = ciphertext;
        let nextContentIvB64 = currentEnvelope.contentIvB64;
        let resolvedPlaintextSha = currentEnvelope.plaintextSha256
            ? currentEnvelope.plaintextSha256.trim().toLowerCase()
            : undefined;
        if (options?.deepReencryptPayload) {
            const oldDekKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(activeDekBytes), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
            try {
                plaintextBuf = await webCrypto.subtle.decrypt({
                    name: 'AES-GCM',
                    iv: toStrictArrayBuffer(base64ToBytes(currentEnvelope.contentIvB64)),
                    additionalData: aadBytes,
                }, oldDekKey, ciphertext);
            }
            catch {
                throw new DrmAuthenticationError('Encrypted archive failed AES-GCM integrity check during deep rotation.');
            }
            if (!resolvedPlaintextSha) {
                resolvedPlaintextSha = await computeSha256Hex(plaintextBuf);
            }
            freshDekBytes = webCrypto.getRandomValues(new Uint8Array(32));
            const freshContentIv = webCrypto.getRandomValues(new Uint8Array(12));
            const newDekKey = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(freshDekBytes), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
            nextCiphertext = await webCrypto.subtle.encrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(freshContentIv),
                additionalData: aadBytes,
            }, newDekKey, plaintextBuf);
            wipeBytes(plaintextBuf);
            plaintextBuf = null;
            activeDekBytes = freshDekBytes;
            nextContentIvB64 = bytesToBase64(freshContentIv);
        }
        // 3. Re-wrap activeDekBytes under targetAuth
        const nextKekIv = webCrypto.getRandomValues(new Uint8Array(12));
        const sealCover = options?.sealCoverWhenLocked ?? currentEnvelope.sealCoverWhenLocked;
        if (targetAuth.mode === 'managed') {
            targetRawKek = await unwrapManagedDrmKeyBytes(targetAuth.keyRecord, targetAuth.passphrase, options?.profile);
            const targetKekCrypto = await webCrypto.subtle.importKey('raw', toStrictArrayBuffer(targetRawKek), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
            const rewrappedDekBuf = await webCrypto.subtle.encrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(nextKekIv),
                additionalData: aadBytes,
            }, targetKekCrypto, toStrictArrayBuffer(activeDekBytes));
            const cleanHint = (targetAuth.keyRecord.keyHint ?? '').trim().slice(0, MAX_DRM_HINT_LENGTH);
            const nextEnvelope = {
                version: 1,
                cipher: 'AES-256-GCM',
                kdf: 'PBKDF2-SHA256',
                iterations: targetAuth.keyRecord.iterations,
                saltB64: targetAuth.keyRecord.saltB64,
                kekIvB64: bytesToBase64(nextKekIv),
                wrappedDekB64: bytesToBase64(new Uint8Array(rewrappedDekBuf)),
                contentIvB64: nextContentIvB64,
                innerFormat: currentEnvelope.innerFormat,
                originalFileName: currentEnvelope.originalFileName,
                plaintextSizeBytes: currentEnvelope.plaintextSizeBytes,
                sealCoverWhenLocked: sealCover,
                ...(cleanHint ? { keyHint: cleanHint } : {}),
                kekScheme: 'managed-key-v1',
                keyId: targetAuth.keyRecord.keyId,
                keyLabel: targetAuth.keyRecord.label,
                keyFingerprint: targetAuth.keyRecord.fingerprint,
                ...(resolvedPlaintextSha ? { plaintextSha256: resolvedPlaintextSha } : {}),
            };
            return { envelope: nextEnvelope, ciphertext: nextCiphertext };
        }
        else {
            if (!targetAuth.passphrase || targetAuth.passphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
                throw new Error(`New passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
            }
            const iterations = Math.max(10_000, Math.round(targetAuth.iterations ?? DEFAULT_PBKDF2_ITERATIONS));
            const nextSalt = webCrypto.getRandomValues(new Uint8Array(16));
            const targetKekCrypto = await deriveKekFromPassphrase(targetAuth.passphrase, nextSalt, iterations, ['encrypt']);
            const rewrappedDekBuf = await webCrypto.subtle.encrypt({
                name: 'AES-GCM',
                iv: toStrictArrayBuffer(nextKekIv),
                additionalData: aadBytes,
            }, targetKekCrypto, toStrictArrayBuffer(activeDekBytes));
            const cleanHint = (targetAuth.keyHint ?? '').trim().slice(0, MAX_DRM_HINT_LENGTH);
            const nextEnvelope = {
                version: 1,
                cipher: 'AES-256-GCM',
                kdf: 'PBKDF2-SHA256',
                iterations,
                saltB64: bytesToBase64(nextSalt),
                kekIvB64: bytesToBase64(nextKekIv),
                wrappedDekB64: bytesToBase64(new Uint8Array(rewrappedDekBuf)),
                contentIvB64: nextContentIvB64,
                innerFormat: currentEnvelope.innerFormat,
                originalFileName: currentEnvelope.originalFileName,
                plaintextSizeBytes: currentEnvelope.plaintextSizeBytes,
                sealCoverWhenLocked: sealCover,
                ...(cleanHint ? { keyHint: cleanHint } : {}),
                ...(resolvedPlaintextSha ? { plaintextSha256: resolvedPlaintextSha } : {}),
            };
            return { envelope: nextEnvelope, ciphertext: nextCiphertext };
        }
    }
    finally {
        wipeBytes(sourceRawKek);
        wipeBytes(targetRawKek);
        wipeBytes(unwrappedDekBuf);
        wipeBytes(freshDekBytes);
        wipeBytes(plaintextBuf);
    }
}
export const rewrapBookDrmKey = rewrapDrmKey;
//# sourceMappingURL=crypto.js.map