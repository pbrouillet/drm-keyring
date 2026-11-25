import { createManagedDrmKey, rotateManagedDrmKey } from './crypto.js';
import { DrmAuthenticationError } from './errors.js';
import {
  decryptDrmKeyringBackup,
  decryptKeyringWithCloudSession,
  encryptDrmKeyringBackup,
  encryptKeyringWithCloudSession,
  mergeRestoredDrmKeys,
  normalizeDefaultDrmKeys,
  parseDrmKeyringBackupJson,
  unlockOrCreateCloudKeyringSession,
} from './keyringCrypto.js';
import type { KeyringStore } from './storage.js';
import type { CloudKeyringSyncProvider } from './sync/types.js';
import type {
  CloudKeyringSessionHandle,
  CreateManagedDrmKeyOptions,
  DrmKeyringEncryptedBackup,
  DrmManagedKey,
  DrmProtocolProfile,
  PersonalDrmEnvelope,
  RemoteKeyringSummary,
  RotateManagedDrmKeyOptions,
} from './types.js';
import { resolveProtocolProfile } from './utils.js';
import { DEFAULT_VOLATILE_KEYRING_TTL_MS, VolatileKeyringCache } from './volatileCache.js';

export interface DrmKeyringManagerState {
  readonly keys: DrmManagedKey[];
  readonly isLoaded: boolean;
  readonly remoteSummary: RemoteKeyringSummary | null;
  readonly isInspectingRemote: boolean;
  readonly isCloudSyncEnabled: boolean;
  readonly cloudSyncHint?: string;
  readonly isCloudSessionUnlocked: boolean;
  readonly isSyncingCloud: boolean;
  readonly cloudSyncError: string | null;
  readonly lastCloudSyncedAt: number;
  readonly hasActiveVolatileKey: boolean;
}

export interface DrmKeyringManagerConfig {
  store: KeyringStore;
  syncProvider?: CloudKeyringSyncProvider | null;
  volatileCache?: VolatileKeyringCache;
  profile?: Partial<DrmProtocolProfile>;
  initialCloudSyncEnabled?: boolean;
  initialCloudSyncHint?: string;
  exportFilePrefix?: string;
  onCloudSyncConfigChange?: (config: { enabled: boolean; hint?: string }) => void;
  onError?: (err: unknown) => void;
}

export interface RotateKeyCommitContext {
  existingKey: DrmManagedKey;
  retiredKey: DrmManagedKey;
  newKey: DrmManagedKey;
  effectiveTargetPassphrase: string;
}

export class DrmKeyringManager {
  private readonly store: KeyringStore;
  private syncProvider: CloudKeyringSyncProvider | null;
  private readonly volatileCache: VolatileKeyringCache;
  private readonly ownsVolatileCache: boolean;
  private readonly profile: DrmProtocolProfile;
  private readonly exportFilePrefix: string;
  private readonly onCloudSyncConfigChange?: (config: { enabled: boolean; hint?: string }) => void;
  private readonly onError?: (err: unknown) => void;
  private readonly listeners = new Set<() => void>();
  private readonly volatileUnsubscribe: () => void;

  private cloudSession: CloudKeyringSessionHandle | null = null;
  private state: DrmKeyringManagerState;

  constructor(config: DrmKeyringManagerConfig) {
    this.store = config.store;
    this.syncProvider = config.syncProvider ?? null;
    this.ownsVolatileCache = !config.volatileCache;
    this.volatileCache = config.volatileCache ?? new VolatileKeyringCache();
    this.profile = resolveProtocolProfile(config.profile);
    this.exportFilePrefix = config.exportFilePrefix ?? 'drm-keyring';
    this.onCloudSyncConfigChange = config.onCloudSyncConfigChange;
    this.onError = config.onError;

    this.state = {
      keys: [],
      isLoaded: false,
      remoteSummary: null,
      isInspectingRemote: false,
      isCloudSyncEnabled: Boolean(config.initialCloudSyncEnabled),
      cloudSyncHint: config.initialCloudSyncHint,
      isCloudSessionUnlocked: false,
      isSyncingCloud: false,
      cloudSyncError: null,
      lastCloudSyncedAt: 0,
      hasActiveVolatileKey: this.volatileCache.hasActiveEntries(),
    };

    this.volatileUnsubscribe = this.volatileCache.subscribe(() => {
      const hasActive = this.volatileCache.size > 0;
      if (hasActive !== this.state.hasActiveVolatileKey) {
        this.patchState({ hasActiveVolatileKey: hasActive });
      }
    });
  }

  getState(): DrmKeyringManagerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private patchState(partial: Partial<DrmKeyringManagerState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  setSyncProvider(provider: CloudKeyringSyncProvider | null): void {
    this.syncProvider = provider;
  }

  setCloudSyncConfig(config: { enabled?: boolean; hint?: string }): void {
    const nextEnabled =
      config.enabled !== undefined ? config.enabled : this.state.isCloudSyncEnabled;
    const nextHint = config.hint !== undefined ? config.hint : this.state.cloudSyncHint;
    if (
      nextEnabled === this.state.isCloudSyncEnabled &&
      nextHint === this.state.cloudSyncHint
    ) {
      return;
    }
    this.patchState({
      isCloudSyncEnabled: nextEnabled,
      cloudSyncHint: nextHint,
    });
  }

  setRemoteSummary(summary: RemoteKeyringSummary | null): void {
    this.patchState({ remoteSummary: summary });
  }

  setCloudSyncError(error: string | null): void {
    this.patchState({ cloudSyncError: error });
  }

  async load(): Promise<DrmManagedKey[]> {
    const raw = await this.store.listKeys();
    const normalized = normalizeDefaultDrmKeys(raw);
    this.patchState({
      keys: normalized,
      isLoaded: true,
    });
    return normalized;
  }

  findKeyForEnvelope(
    envelope?: Pick<PersonalDrmEnvelope, 'keyId' | 'keyFingerprint'> | null
  ): DrmManagedKey | null {
    if (!envelope) return null;
    return (
      this.state.keys.find(
        (k) =>
          (envelope.keyId && k.keyId === envelope.keyId) ||
          (envelope.keyFingerprint && k.fingerprint === envelope.keyFingerprint)
      ) ?? null
    );
  }

  async createKey(options: CreateManagedDrmKeyOptions): Promise<DrmManagedKey> {
    const created = await createManagedDrmKey({
      ...options,
      profile: options.profile ?? this.profile,
    });
    const nextKeys = normalizeDefaultDrmKeys(
      [created, ...this.state.keys],
      options.isDefault ? created.keyId : undefined
    );
    await this.store.saveKeysBatch(nextKeys, true);
    this.patchState({ keys: nextKeys });
    void this.pushCloudIfUnlocked(nextKeys);
    return created;
  }

  async rotateKey(
    keyId: string,
    currentPassphrase: string,
    options?: RotateManagedDrmKeyOptions & {
      onBeforeCommit?: (ctx: RotateKeyCommitContext) => Promise<void>;
    }
  ): Promise<{ retiredKey: DrmManagedKey; newKey: DrmManagedKey }> {
    const existingKey = this.state.keys.find((k) => k.keyId === keyId);
    if (!existingKey) {
      throw new Error('Target Managed DRM Key was not found in your local keyring.');
    }

    const effectiveTargetPassphrase =
      options?.newPassphrase && options.newPassphrase.length > 0
        ? options.newPassphrase
        : currentPassphrase;

    const { retiredKey, newKey } = await rotateManagedDrmKey(existingKey, currentPassphrase, {
      newPassphrase: options?.newPassphrase,
      newLabel: options?.newLabel,
      newKeyHint: options?.newKeyHint,
      iterations: options?.iterations,
      profile: options?.profile ?? this.profile,
    });

    if (options?.onBeforeCommit) {
      await options.onBeforeCommit({
        existingKey,
        retiredKey,
        newKey,
        effectiveTargetPassphrase,
      });
    }

    const remaining = this.state.keys.filter((k) => k.keyId !== existingKey.keyId);
    const nextKeys = normalizeDefaultDrmKeys(
      [newKey, retiredKey, ...remaining],
      existingKey.isDefault ? newKey.keyId : undefined
    );
    await this.store.saveKeysBatch(nextKeys, true);
    this.patchState({ keys: nextKeys });
    void this.pushCloudIfUnlocked(nextKeys);

    // Migrate active volatile RAM unlock entry if the rotated key was currently unlocked
    this.volatileCache.hasActiveEntries();
    const activeVolatile = this.volatileCache.get(existingKey.keyId);
    if (activeVolatile) {
      const remainingMs = Math.max(
        activeVolatile.durationMs || DEFAULT_VOLATILE_KEYRING_TTL_MS,
        activeVolatile.expiresAt - Date.now()
      );
      this.volatileCache.delete(existingKey.keyId);
      this.volatileCache.upsert(newKey.keyId, effectiveTargetPassphrase, remainingMs);
    }

    return { retiredKey, newKey };
  }

  async setDefaultKey(keyId: string): Promise<DrmManagedKey[]> {
    const nextKeys = normalizeDefaultDrmKeys(this.state.keys, keyId);
    await this.store.saveKeysBatch(nextKeys, true);
    this.patchState({ keys: nextKeys });
    void this.pushCloudIfUnlocked(nextKeys);
    return nextKeys;
  }

  async deleteKey(keyId: string): Promise<DrmManagedKey[]> {
    await this.store.deleteKey(keyId);
    this.volatileCache.delete(keyId);

    const filtered = this.state.keys.filter((k) => k.keyId !== keyId);
    const nextKeys = normalizeDefaultDrmKeys(filtered);
    await this.store.saveKeysBatch(nextKeys, true);
    this.patchState({
      keys: nextKeys,
      hasActiveVolatileKey: this.volatileCache.size > 0,
    });
    if (nextKeys.length > 0) {
      void this.pushCloudIfUnlocked(nextKeys);
    }
    return nextKeys;
  }

  async refreshRemoteStatus(options?: {
    interactive?: boolean;
  }): Promise<RemoteKeyringSummary | null> {
    if (!this.syncProvider) {
      this.patchState({ remoteSummary: null, isInspectingRemote: false });
      return null;
    }

    this.patchState({ isInspectingRemote: true });
    try {
      const summary = await this.syncProvider.inspect({
        interactive: options?.interactive ?? false,
      });
      this.patchState({ remoteSummary: summary });
      return summary;
    } catch (err) {
      this.onError?.(err);
      this.patchState({ remoteSummary: null });
      return null;
    } finally {
      this.patchState({ isInspectingRemote: false });
    }
  }

  async backupToRemote(
    backupPassphrase: string,
    backupHint = '',
    iterations?: number
  ): Promise<RemoteKeyringSummary> {
    if (!this.syncProvider) {
      throw new Error('No cloud keyring sync provider is configured.');
    }
    const encryptedBackup = await encryptDrmKeyringBackup(this.state.keys, backupPassphrase, {
      backupHint,
      iterations,
      profile: this.profile,
    });
    const summary = await this.syncProvider.push(encryptedBackup, { interactive: true });
    this.patchState({ remoteSummary: summary });
    return summary;
  }

  async restoreFromRemote(
    backupPassphrase: string,
    strategy: 'merge' | 'replace'
  ): Promise<{ restoredCount: number; totalKeyCount: number }> {
    if (!this.syncProvider) {
      throw new Error('No cloud keyring sync provider is configured.');
    }
    const remoteBackup = await this.syncProvider.pull({ interactive: true });
    if (!remoteBackup) {
      throw new Error('No DRM keyring backup was found in remote cloud storage.');
    }
    const restoredKeys = await decryptDrmKeyringBackup(remoteBackup, backupPassphrase, {
      profile: this.profile,
    });
    const merged = mergeRestoredDrmKeys(this.state.keys, restoredKeys, strategy);
    await this.store.saveKeysBatch(merged, true);
    this.patchState({ keys: merged });
    void this.refreshRemoteStatus({ interactive: false });
    return { restoredCount: restoredKeys.length, totalKeyCount: merged.length };
  }

  async deleteRemoteBackup(): Promise<void> {
    if (!this.syncProvider) {
      throw new Error('No cloud keyring sync provider is configured.');
    }
    await this.syncProvider.delete({ interactive: true });
    this.patchState({ remoteSummary: null });
  }

  async pushCloudIfUnlocked(keysToPush: DrmManagedKey[] = this.state.keys): Promise<void> {
    const activeSession = this.cloudSession;
    if (
      !activeSession ||
      !this.state.isCloudSyncEnabled ||
      !this.syncProvider ||
      keysToPush.length === 0
    ) {
      return;
    }

    this.patchState({ isSyncingCloud: true });
    try {
      const sealed = await encryptKeyringWithCloudSession(keysToPush, activeSession, {
        backupHint: this.state.cloudSyncHint ?? activeSession.backupHint,
        profile: this.profile,
      });
      const summary = await this.syncProvider.push(sealed, { interactive: false });
      this.patchState({
        remoteSummary: summary,
        lastCloudSyncedAt: Date.now(),
        cloudSyncError: null,
      });
    } catch (err) {
      this.onError?.(err);
      this.patchState({
        cloudSyncError:
          err instanceof Error ? err.message : 'Unable to auto-sync Cloud Keyring.',
      });
    } finally {
      this.patchState({ isSyncingCloud: false });
    }
  }

  async enableAndUnlockCloudSync(options: {
    masterPassphrase: string;
    backupHint?: string;
    forceOverwriteRemote?: boolean;
    iterations?: number;
  }): Promise<{ mergedCount: number; pushed: boolean }> {
    if (!this.syncProvider) {
      throw new Error('No cloud keyring sync provider is configured.');
    }

    this.patchState({ isSyncingCloud: true, cloudSyncError: null });
    try {
      const existingRemote = options.forceOverwriteRemote
        ? null
        : await this.syncProvider.pull({ interactive: true });

      const { session, remoteKeys } = await unlockOrCreateCloudKeyringSession(
        options.masterPassphrase,
        existingRemote,
        {
          backupHint:
            options.backupHint ?? this.state.cloudSyncHint ?? existingRemote?.backupHint,
          iterations: options.iterations,
          profile: this.profile,
        }
      );

      const merged =
        remoteKeys.length > 0
          ? mergeRestoredDrmKeys(this.state.keys, remoteKeys, 'merge')
          : normalizeDefaultDrmKeys(this.state.keys);

      await this.store.saveKeysBatch(merged, true);
      this.cloudSession = session;

      const effectiveHint = session.backupHint ?? options.backupHint?.trim() ?? '';
      this.patchState({
        keys: merged,
        isCloudSessionUnlocked: true,
        isCloudSyncEnabled: true,
        cloudSyncHint: effectiveHint || this.state.cloudSyncHint,
      });

      this.onCloudSyncConfigChange?.({
        enabled: true,
        ...(effectiveHint ? { hint: effectiveHint } : {}),
      });

      if (merged.length > 0) {
        const sealed = await encryptKeyringWithCloudSession(merged, session, {
          backupHint: effectiveHint || undefined,
          profile: this.profile,
        });
        const summary = await this.syncProvider.push(sealed, { interactive: true });
        this.patchState({
          remoteSummary: summary,
          lastCloudSyncedAt: Date.now(),
        });
        return { mergedCount: merged.length, pushed: true };
      }

      return { mergedCount: 0, pushed: false };
    } catch (err) {
      this.onError?.(err);
      const msg = err instanceof Error ? err.message : 'Unable to enable Cloud Keyring sync.';
      this.patchState({ cloudSyncError: msg });
      throw err;
    } finally {
      this.patchState({ isSyncingCloud: false });
    }
  }

  async syncCloudKeyringNow(): Promise<{ mergedCount: number; pushed: boolean }> {
    const activeSession = this.cloudSession;
    if (!activeSession) {
      throw new DrmAuthenticationError('Unlock your Cloud Keyring session before syncing.');
    }
    if (!this.syncProvider) {
      throw new Error('No cloud keyring sync provider is configured.');
    }

    this.patchState({ isSyncingCloud: true, cloudSyncError: null });
    try {
      const remoteBackup = await this.syncProvider.pull({ interactive: true });
      let merged = normalizeDefaultDrmKeys(this.state.keys);

      if (remoteBackup) {
        const remoteKeys = await decryptKeyringWithCloudSession(remoteBackup, activeSession, {
          profile: this.profile,
        });
        merged = mergeRestoredDrmKeys(this.state.keys, remoteKeys, 'merge');
        await this.store.saveKeysBatch(merged, true);
        this.patchState({ keys: merged });
      }

      if (merged.length > 0) {
        const sealed = await encryptKeyringWithCloudSession(merged, activeSession, {
          backupHint: this.state.cloudSyncHint ?? activeSession.backupHint,
          profile: this.profile,
        });
        const summary = await this.syncProvider.push(sealed, { interactive: true });
        this.patchState({
          remoteSummary: summary,
          lastCloudSyncedAt: Date.now(),
        });
        return { mergedCount: merged.length, pushed: true };
      }

      return { mergedCount: 0, pushed: false };
    } catch (err) {
      if (err instanceof DrmAuthenticationError) {
        this.lockCloudSession();
      } else {
        this.onError?.(err);
      }
      const msg = err instanceof Error ? err.message : 'Cloud Keyring synchronization failed.';
      this.patchState({ cloudSyncError: msg });
      throw err;
    } finally {
      this.patchState({ isSyncingCloud: false });
    }
  }

  async rotateCloudMasterPassphrase(options: {
    newMasterPassphrase: string;
    newHint?: string;
    iterations?: number;
  }): Promise<void> {
    if (!this.syncProvider) {
      throw new Error('No cloud keyring sync provider is configured.');
    }

    this.patchState({ isSyncingCloud: true, cloudSyncError: null });
    try {
      const { session } = await unlockOrCreateCloudKeyringSession(
        options.newMasterPassphrase,
        null,
        {
          backupHint: options.newHint,
          iterations: options.iterations,
          profile: this.profile,
        }
      );
      this.cloudSession = session;

      const cleanHint = (options.newHint ?? '').trim();
      this.patchState({
        isCloudSessionUnlocked: true,
        isCloudSyncEnabled: true,
        cloudSyncHint: cleanHint || undefined,
      });

      this.onCloudSyncConfigChange?.({
        enabled: true,
        hint: cleanHint || undefined,
      });

      const currentKeys = normalizeDefaultDrmKeys(this.state.keys);
      if (currentKeys.length > 0) {
        const sealed = await encryptKeyringWithCloudSession(currentKeys, session, {
          backupHint: cleanHint || undefined,
          profile: this.profile,
        });
        const summary = await this.syncProvider.push(sealed, { interactive: true });
        this.patchState({
          remoteSummary: summary,
          lastCloudSyncedAt: Date.now(),
        });
      }
    } catch (err) {
      this.onError?.(err);
      const msg =
        err instanceof Error ? err.message : 'Failed to rotate Cloud Keyring Master Passphrase.';
      this.patchState({ cloudSyncError: msg });
      throw err;
    } finally {
      this.patchState({ isSyncingCloud: false });
    }
  }

  lockCloudSession(): void {
    this.cloudSession = null;
    if (this.state.isCloudSessionUnlocked) {
      this.patchState({ isCloudSessionUnlocked: false });
    }
  }

  async disableCloudSync(deleteRemoteFile: boolean): Promise<void> {
    this.lockCloudSession();
    this.patchState({
      isCloudSyncEnabled: false,
      cloudSyncError: null,
    });
    this.onCloudSyncConfigChange?.({
      enabled: false,
      hint: this.state.cloudSyncHint,
    });

    if (deleteRemoteFile && this.syncProvider) {
      await this.deleteRemoteBackup();
    }
  }

  async exportEncryptedBackup(
    backupPassphrase: string,
    backupHint = '',
    iterations?: number
  ): Promise<{ backup: DrmKeyringEncryptedBackup; fileName: string; json: string }> {
    const encrypted = await encryptDrmKeyringBackup(this.state.keys, backupPassphrase, {
      backupHint,
      iterations,
      profile: this.profile,
    });
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `${this.exportFilePrefix}-${dateStamp}.nkey.json`;
    const json = JSON.stringify(encrypted, null, 2);
    return { backup: encrypted, fileName, json };
  }

  async importEncryptedBackup(
    rawJson: string,
    backupPassphrase: string,
    strategy: 'merge' | 'replace'
  ): Promise<{ restoredCount: number; totalKeyCount: number }> {
    const parsed = parseDrmKeyringBackupJson(rawJson, { profile: this.profile });
    const restoredKeys = await decryptDrmKeyringBackup(parsed, backupPassphrase, {
      profile: this.profile,
    });
    const merged = mergeRestoredDrmKeys(this.state.keys, restoredKeys, strategy);
    await this.store.saveKeysBatch(merged, true);
    this.patchState({ keys: merged });
    if (merged.length > 0) {
      void this.pushCloudIfUnlocked(merged);
    }
    return { restoredCount: restoredKeys.length, totalKeyCount: merged.length };
  }

  cacheVolatilePassphrase(
    cacheKey: string,
    passphrase: string,
    durationMs: number = DEFAULT_VOLATILE_KEYRING_TTL_MS
  ): void {
    this.volatileCache.upsert(cacheKey, passphrase, durationMs);
  }

  clearVolatilePassphrases(): void {
    this.volatileCache.clear();
  }

  touchVolatileOnSessionIdle(): void {
    this.volatileCache.touchOnSessionIdle();
  }

  resolveVolatileCandidates(
    preferredCacheKey?: string | null
  ): Array<{ cacheKey: string; passphrase: string; durationMs: number }> {
    return this.volatileCache.resolveCandidates(preferredCacheKey);
  }

  dispose(): void {
    this.volatileUnsubscribe();
    if (this.ownsVolatileCache) {
      this.volatileCache.dispose();
    }
    this.lockCloudSession();
    this.listeners.clear();
  }
}
