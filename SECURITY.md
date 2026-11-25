# Security Specification — `@pbrouillet/drm-keyring`

## 1. Zero-Knowledge Threat Model

- **Passphrases are never persisted**: Passphrases and Master Passphrases are encoded to UTF-8 bytes in RAM, fed into `PBKDF2-HMAC-SHA256`, and immediately zeroed via `wipeBytes()`.
- **Non-extractable Cloud Session Key**: `unlockOrCreateCloudKeyringSession()` derives an `AES-256-GCM` `CryptoKey` with `extractable: false`. Only that volatile handle resides in memory while the session is unlocked.
- **Zero-plaintext storage**: Managed keys (`DrmManagedKey`) are stored at rest wrapped under a per-key 256-bit `PBKDF2-SHA256` KEK using `AES-256-GCM` with authenticated `keyId` and `fingerprint` AAD.

## 2. Cryptographic Parameters

- **KDF**: `PBKDF2-HMAC-SHA256`, default `210,000` iterations (minimum enforced: `10,000`), 128-bit (`16` byte) CSPRNG salt per wrapped key / standalone envelope / backup bundle.
- **Cipher**: `AES-256-GCM` with fresh 96-bit (`12` byte) CSPRNG IVs on every encryption, DEK wrap, key rotation, and cloud push.
- **Key Fingerprint**: `SHA-256("nocturne-drm-key-fp-v1:" || rawKek32)` truncated to the first 8 bytes formatted as `XXXX-XXXX-XXXX-XXXX` uppercase hex.

## 3. Two-Tier Envelope Encryption & `.ndrm` v1 Format

1. A fresh random 256-bit Data-Encryption Key (DEK) is generated per protected item.
2. Content bytes are encrypted under the DEK with `AES-256-GCM` and canonical JSON AAD binding `app`, `version: 1`, `cipher`, `innerFormat`, and `plaintextSizeBytes`.
3. The DEK is wrapped under either:
   - `passphrase-pbkdf2`: a PBKDF2-derived KEK from a standalone passphrase, or
   - `managed-key-v1`: the 256-bit raw KEK unwrapped in RAM from a `DrmManagedKey`, then wiped in `finally`.
4. **`.ndrm` Binary Layout**:
   - Bytes `0..3`: ASCII `"NDRM"` (`0x4E 0x44 0x52 0x4D`)
   - Byte `4`: Container version (`0x01`)
   - Bytes `5..8`: Big-endian `uint32` JSON header length `L` (`3 <= L <= 65536`)
   - Bytes `9..9+L-1`: UTF-8 JSON `PersonalDrmEnvelope`
   - Bytes `9+L..EOF`: Raw `AES-256-GCM` ciphertext + 128-bit authentication tag

## 4. Double-Layer Keyring Backup & Cloud Sync

- `DrmKeyringEncryptedBackup` (`.nkey.json` or Google Drive `appDataFolder` file `nocturne-drm-keyring-v1.enc.json`) seals the array of already-wrapped `DrmManagedKey` objects inside an outer `AES-256-GCM` envelope.
- Canonical AAD binds `app`, `schemaVersion`, `backupId`, `createdAt`, `keyCount`, and `keyFingerprints` so any tampering with cleartext header metadata invalidates the GCM tag.
- Every cloud push rotates to a new random 96-bit IV; rotating the Master Passphrase generates a new 128-bit PBKDF2 salt so stale sessions on other devices fail authentication cleanly and lock immediately.

## 5. Volatile Memory Hygiene

- All temporary key buffers (`rawKek`, `rawDek`, `plaintextBuf`, `payloadBytes`, `combined`) are overwritten with zeros in `finally` blocks via `wipeBytes()`.
- `VolatileKeyringCache` defers idle expiration while an active session callback returns `true`, refreshes a full TTL window on `touchOnSessionIdle()`, and wipes all entries on `pagehide` when enabled.
