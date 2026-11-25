import type { KeyringStore } from './storage.js';
import type { CloudKeyringSyncProvider } from './sync/types.js';
import type { CreateManagedDrmKeyOptions, DrmKeyringEncryptedBackup, DrmManagedKey, DrmProtocolProfile, PersonalDrmEnvelope, RemoteKeyringSummary, RotateManagedDrmKeyOptions } from './types.js';
import { VolatileKeyringCache } from './volatileCache.js';
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
    onCloudSyncConfigChange?: (config: {
        enabled: boolean;
        hint?: string;
    }) => void;
    onError?: (err: unknown) => void;
}
export interface RotateKeyCommitContext {
    existingKey: DrmManagedKey;
    retiredKey: DrmManagedKey;
    newKey: DrmManagedKey;
    effectiveTargetPassphrase: string;
}
export declare class DrmKeyringManager {
    private readonly store;
    private syncProvider;
    private readonly volatileCache;
    private readonly ownsVolatileCache;
    private readonly profile;
    private readonly exportFilePrefix;
    private readonly onCloudSyncConfigChange?;
    private readonly onError?;
    private readonly listeners;
    private readonly volatileUnsubscribe;
    private cloudSession;
    private state;
    constructor(config: DrmKeyringManagerConfig);
    getState(): DrmKeyringManagerState;
    subscribe(listener: () => void): () => void;
    private patchState;
    setSyncProvider(provider: CloudKeyringSyncProvider | null): void;
    setCloudSyncConfig(config: {
        enabled?: boolean;
        hint?: string;
    }): void;
    setRemoteSummary(summary: RemoteKeyringSummary | null): void;
    setCloudSyncError(error: string | null): void;
    load(): Promise<DrmManagedKey[]>;
    findKeyForEnvelope(envelope?: Pick<PersonalDrmEnvelope, 'keyId' | 'keyFingerprint'> | null): DrmManagedKey | null;
    createKey(options: CreateManagedDrmKeyOptions): Promise<DrmManagedKey>;
    rotateKey(keyId: string, currentPassphrase: string, options?: RotateManagedDrmKeyOptions & {
        onBeforeCommit?: (ctx: RotateKeyCommitContext) => Promise<void>;
    }): Promise<{
        retiredKey: DrmManagedKey;
        newKey: DrmManagedKey;
    }>;
    setDefaultKey(keyId: string): Promise<DrmManagedKey[]>;
    deleteKey(keyId: string): Promise<DrmManagedKey[]>;
    refreshRemoteStatus(options?: {
        interactive?: boolean;
    }): Promise<RemoteKeyringSummary | null>;
    backupToRemote(backupPassphrase: string, backupHint?: string, iterations?: number): Promise<RemoteKeyringSummary>;
    restoreFromRemote(backupPassphrase: string, strategy: 'merge' | 'replace'): Promise<{
        restoredCount: number;
        totalKeyCount: number;
    }>;
    deleteRemoteBackup(): Promise<void>;
    pushCloudIfUnlocked(keysToPush?: DrmManagedKey[]): Promise<void>;
    enableAndUnlockCloudSync(options: {
        masterPassphrase: string;
        backupHint?: string;
        forceOverwriteRemote?: boolean;
        iterations?: number;
    }): Promise<{
        mergedCount: number;
        pushed: boolean;
    }>;
    syncCloudKeyringNow(): Promise<{
        mergedCount: number;
        pushed: boolean;
    }>;
    rotateCloudMasterPassphrase(options: {
        newMasterPassphrase: string;
        newHint?: string;
        iterations?: number;
    }): Promise<void>;
    lockCloudSession(): void;
    disableCloudSync(deleteRemoteFile: boolean): Promise<void>;
    exportEncryptedBackup(backupPassphrase: string, backupHint?: string, iterations?: number): Promise<{
        backup: DrmKeyringEncryptedBackup;
        fileName: string;
        json: string;
    }>;
    importEncryptedBackup(rawJson: string, backupPassphrase: string, strategy: 'merge' | 'replace'): Promise<{
        restoredCount: number;
        totalKeyCount: number;
    }>;
    cacheVolatilePassphrase(cacheKey: string, passphrase: string, durationMs?: number): void;
    clearVolatilePassphrases(): void;
    touchVolatileOnSessionIdle(): void;
    resolveVolatileCandidates(preferredCacheKey?: string | null): Array<{
        cacheKey: string;
        passphrase: string;
        durationMs: number;
    }>;
    dispose(): void;
}
//# sourceMappingURL=manager.d.ts.map