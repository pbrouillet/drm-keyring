export declare const DEFAULT_VOLATILE_KEYRING_TTL_MINUTES = 15;
export declare const DEFAULT_VOLATILE_KEYRING_TTL_MS: number;
export interface VolatileKeyringCacheEntry {
    passphrase: string;
    durationMs: number;
    expiresAt: number;
}
export declare function pruneExpiredVolatileKeyringEntries(cache: Map<string, VolatileKeyringCacheEntry>, now?: number, isReaderOpen?: boolean): {
    nextExpiryDelayMs: number | null;
    hasActiveEntries: boolean;
};
export declare function upsertVolatileKeyringEntry(cache: Map<string, VolatileKeyringCacheEntry>, cacheKey: string, passphrase: string, durationMs?: number, now?: number, isReaderOpen?: boolean): {
    nextExpiryDelayMs: number | null;
    hasActiveEntries: boolean;
};
export declare function touchVolatileKeyringEntriesOnReaderClose(cache: Map<string, VolatileKeyringCacheEntry>, now?: number): {
    nextExpiryDelayMs: number | null;
    hasActiveEntries: boolean;
};
export declare const touchVolatileKeyringEntriesOnSessionIdle: typeof touchVolatileKeyringEntriesOnReaderClose;
export declare function resolveVolatileKeyringCandidatePassphrases(cache: Map<string, VolatileKeyringCacheEntry>, options?: {
    preferredCacheKey?: string | null;
    now?: number;
    isReaderOpen?: boolean;
}): Array<{
    cacheKey: string;
    passphrase: string;
    durationMs: number;
}>;
export interface VolatileKeyringCacheOptions {
    defaultTtlMs?: number;
    isSessionActive?: () => boolean;
    bindPageHide?: boolean;
    onAutoLock?: () => void;
}
export declare class VolatileKeyringCache {
    readonly entries: Map<string, VolatileKeyringCacheEntry>;
    private readonly defaultTtlMs;
    private readonly isSessionActive;
    private readonly onAutoLock?;
    private readonly listeners;
    private expiryTimer;
    private pageHideCleanup;
    constructor(options?: VolatileKeyringCacheOptions);
    get size(): number;
    hasActiveEntries(now?: number): boolean;
    get(cacheKey: string): VolatileKeyringCacheEntry | undefined;
    upsert(cacheKey: string, passphrase: string, durationMs?: number, now?: number): {
        nextExpiryDelayMs: number | null;
        hasActiveEntries: boolean;
    };
    delete(cacheKey: string): boolean;
    clear(): void;
    touchOnSessionIdle(now?: number): {
        nextExpiryDelayMs: number | null;
        hasActiveEntries: boolean;
    };
    resolveCandidates(preferredCacheKey?: string | null, now?: number): Array<{
        cacheKey: string;
        passphrase: string;
        durationMs: number;
    }>;
    subscribe(listener: () => void): () => void;
    dispose(): void;
    private notify;
    private clearTimer;
    private scheduleExpiryCheck;
}
//# sourceMappingURL=volatileCache.d.ts.map