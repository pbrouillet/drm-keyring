# @pbrouillet/drm-keyring

Zero-knowledge client-side Personal DRM (`.ndrm`), Managed Keyring Vault, volatile RAM passphrase cache, and end-to-end encrypted (E2EE) Cloud Keyring Sync library built exclusively on the Web Crypto API (`crypto.subtle`) with zero runtime dependencies.

## Architecture

```
+-------------------------------------------------------------------------+
| Host App / React UI (@pbrouillet/drm-keyring/react)                     |
|  CloudKeyringPanel | DrmKeyVaultPanel | ExportImportWizard | UnlockModal|
+------------------------------------+------------------------------------+
                                     | useDrmKeyringManager
                                     v
+-------------------------------------------------------------------------+
| DrmKeyringManager (src/manager.ts)                                      |
|  - Managed Key CRUD & atomic key rotation with onBeforeCommit hook      |
|  - Portable .nkey.json encrypted backup export / import (merge/replace) |
|  - Opt-in Cloud Keyring E2EE session (non-extractable CryptoKey in RAM) |
+-------------+--------------------------+--------------------------------+
              |                          |
              v                          v
+---------------------------+  +------------------------------------------+
| KeyringStore              |  | CloudKeyringSyncProvider                 |
| - IndexedDbKeyringStore   |  | - GoogleDriveKeyringSyncProvider         |
| - SqliteKeyringStore      |  | - FirebaseKeyringSyncProvider            |
| - FirestoreKeyringStore   |  | - SqliteKeyringSyncProvider              |
| - MemoryKeyringStore      |  | - MemoryCloudKeyringSyncProvider         |
+---------------------------+  +------------------------------------------+
              |
              v
+-------------------------------------------------------------------------+
| Cryptographic Primitives & Container Format                             |
| - PBKDF2-HMAC-SHA256 (210k iter) + AES-256-GCM envelope wrapping        |
| - .ndrm v1 binary containers + HTTP Range 64 KB header peek             |
| - VolatileKeyringCache (TTL deferred during active session, pagehide)   |
+-------------------------------------------------------------------------+
```

## Installation

From the private GitHub repository:

```json
{
  "dependencies": {
    "@pbrouillet/drm-keyring": "github:pbrouillet/drm-keyring"
  }
}
```

Or with npm / bun:

```bash
npm install github:pbrouillet/drm-keyring
# or
bun add github:pbrouillet/drm-keyring
```

### Tailwind CSS v4 Note (React UI)

If you use the `@pbrouillet/drm-keyring/react` components with Tailwind CSS v4, add `@source` to your main CSS entrypoint so utility classes used by the prebuilt UI components are scanned:

```css
@import "tailwindcss";
@source "../node_modules/@pbrouillet/drm-keyring/dist";
```

## Quickstart

### 1. Encrypt / Decrypt a `.ndrm` Container

```ts
import {
  createManagedDrmKey,
  encryptBookWithManagedDrmKey,
  decryptBookWithManagedDrmKey,
  packNdrmContainer,
  unpackNdrmContainer,
  wipeBytes,
} from '@pbrouillet/drm-keyring';

const key = await createManagedDrmKey({
  label: 'Primary Archive Key',
  passphrase: 'correct-horse-battery-staple',
});

const { envelope, ciphertext } = await encryptBookWithManagedDrmKey(
  plaintextBytes,
  key,
  'correct-horse-battery-staple',
  {
    innerFormat: 'CBZ',
    originalFileName: 'volume-01.cbz',
  }
);

const ndrmBuffer = packNdrmContainer(envelope, ciphertext);
const unpacked = unpackNdrmContainer(ndrmBuffer);
const decrypted = await decryptBookWithManagedDrmKey(
  unpacked.ciphertext,
  unpacked.envelope,
  key,
  'correct-horse-battery-staple'
);

wipeBytes(decrypted);
```

### 2. Managed Keyring & Google Drive `appDataFolder` E2EE Sync

```ts
import {
  DrmKeyringManager,
  IndexedDbKeyringStore,
} from '@pbrouillet/drm-keyring';
import { GoogleDriveKeyringSyncProvider } from '@pbrouillet/drm-keyring/google-drive';

const manager = new DrmKeyringManager({
  store: new IndexedDbKeyringStore(),
  syncProvider: new GoogleDriveKeyringSyncProvider({
    getAccessToken: async ({ interactive }) => getOAuthToken(interactive),
  }),
});

await manager.load();

// Opt-in zero-knowledge Cloud Keyring sync (derives extractable: false CryptoKey in RAM)
await manager.enableAndUnlockCloudSync({
  masterPassphrase: 'master-vault-passphrase',
  backupHint: 'Studio notebook',
});

await manager.createKey({
  label: 'Archive Key',
  passphrase: 'item-unlock-passphrase',
});
```

### 3. SQLite Keyring Store & Sync (`node:sqlite`, `better-sqlite3`, `bun:sqlite`, or async `SqliteExecutor`)

```ts
import { DatabaseSync } from 'node:sqlite';
import { DrmKeyringManager } from '@pbrouillet/drm-keyring';
import { SqliteKeyringStore, SqliteKeyringSyncProvider } from '@pbrouillet/drm-keyring/sqlite';

const db = new DatabaseSync('./vault.sqlite');

const manager = new DrmKeyringManager({
  store: new SqliteKeyringStore({ database: db }),
  syncProvider: new SqliteKeyringSyncProvider({
    database: db,
    ownerId: 'user-123',
  }),
});

await manager.load();
```

### 4. Firebase Firestore Keyring Sync & Hardened Rules

```ts
import { getFirestore } from 'firebase/firestore';
import { DrmKeyringManager, IndexedDbKeyringStore } from '@pbrouillet/drm-keyring';
import {
  FirebaseKeyringSyncProvider,
  FirestoreKeyringStore,
} from '@pbrouillet/drm-keyring/firebase';

const db = getFirestore();

const manager = new DrmKeyringManager({
  store: new IndexedDbKeyringStore(), // or new FirestoreKeyringStore({ db, getOwnerId: () => auth.currentUser?.uid ?? null })
  syncProvider: new FirebaseKeyringSyncProvider({
    db,
    getOwnerId: () => auth.currentUser?.uid ?? null,
  }),
});
```

Deploy or merge [`firestore.drm-keyring.rules`](./firestore.drm-keyring.rules) into your Firebase project's Firestore rules to enforce `ownerId == request.auth.uid`, email verification, and anti-shadow-field validation on `drmKeyrings` and `drmManagedKeys`.

### 5. Volatile RAM Passphrase Cache

```ts
import { VolatileKeyringCache } from '@pbrouillet/drm-keyring';

const cache = new VolatileKeyringCache({
  isSessionActive: () => isReaderOpen,
  bindPageHide: true,
});

cache.upsert('drmk_123', 'secret-passphrase');
const candidates = cache.resolveCandidates('drmk_123');
```

## Entrypoints

- **`@pbrouillet/drm-keyring`**: Types, constants, errors, Web Crypto DRM operations (`createManagedDrmKey`, `rotateManagedDrmKey`, `encryptWithPersonalDrm`, `encryptWithManagedDrmKey`, `decryptWithPersonalDrm`, `decryptWithManagedDrmKey`, `rewrapDrmKey`), `.ndrm` binary container tools (`packNdrmContainer`, `unpackNdrmContainer`, `peekNdrmContainerEnvelope`, `peekRemoteNdrmEnvelope`), keyring backup/session crypto, `VolatileKeyringCache`, `IndexedDbKeyringStore`, `MemoryKeyringStore`, `MemoryCloudKeyringSyncProvider`, and `DrmKeyringManager`.
- **`@pbrouillet/drm-keyring/google-drive`**: `GoogleDriveKeyringSyncProvider` and functional Google Drive `appDataFolder` helpers (`inspectDriveDrmKeyringBackup`, `pullDrmKeyringBackupFromDrive`, `pushDrmKeyringBackupToDrive`, `deleteDrmKeyringBackupFromDrive`).
- **`@pbrouillet/drm-keyring/sqlite`**: `SqliteKeyringStore`, `SqliteKeyringSyncProvider`, and `createSyncSqliteExecutor` (works with `node:sqlite`, `better-sqlite3`, `bun:sqlite`, or any async `SqliteExecutor`).
- **`@pbrouillet/drm-keyring/firebase`**: `FirebaseKeyringSyncProvider`, `FirestoreKeyringStore`, `createFirebaseFirestoreAdapter`, and `classifyFirebaseKeyringError` (optional `firebase` peer dependency).
- **`@pbrouillet/drm-keyring/react`**: `useDrmKeyringManager`, `CloudKeyringPanel`, `DrmKeyVaultPanel`, `DrmKeyringExportImportWizard`, `UnlockDrmModal`, and `KeyringConfirmDialog` (optional `react` and `lucide-react` peer dependencies).
