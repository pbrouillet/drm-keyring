export const DEFAULT_VOLATILE_KEYRING_TTL_MINUTES = 15;
export const DEFAULT_VOLATILE_KEYRING_TTL_MS = DEFAULT_VOLATILE_KEYRING_TTL_MINUTES * 60_000;

export interface VolatileKeyringCacheEntry {
  passphrase: string;
  durationMs: number;
  expiresAt: number;
}

export function pruneExpiredVolatileKeyringEntries(
  cache: Map<string, VolatileKeyringCacheEntry>,
  now: number = Date.now(),
  isReaderOpen: boolean = false
): { nextExpiryDelayMs: number | null; hasActiveEntries: boolean } {
  if (!isReaderOpen) {
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }

  if (cache.size === 0) {
    return { nextExpiryDelayMs: null, hasActiveEntries: false };
  }

  let earliestExpiry = 0;
  for (const entry of cache.values()) {
    if (earliestExpiry === 0 || entry.expiresAt < earliestExpiry) {
      earliestExpiry = entry.expiresAt;
    }
  }

  const nextExpiryDelayMs = Math.max(1_000, earliestExpiry - now);
  return {
    nextExpiryDelayMs,
    hasActiveEntries: true,
  };
}

export function upsertVolatileKeyringEntry(
  cache: Map<string, VolatileKeyringCacheEntry>,
  cacheKey: string,
  passphrase: string,
  durationMs: number = DEFAULT_VOLATILE_KEYRING_TTL_MS,
  now: number = Date.now(),
  isReaderOpen: boolean = false
): { nextExpiryDelayMs: number | null; hasActiveEntries: boolean } {
  pruneExpiredVolatileKeyringEntries(cache, now, isReaderOpen);
  if (durationMs > 0 && passphrase.length > 0) {
    cache.set(cacheKey, {
      passphrase,
      durationMs,
      expiresAt: now + durationMs,
    });
  }
  return pruneExpiredVolatileKeyringEntries(cache, now, isReaderOpen);
}

export function touchVolatileKeyringEntriesOnReaderClose(
  cache: Map<string, VolatileKeyringCacheEntry>,
  now: number = Date.now()
): { nextExpiryDelayMs: number | null; hasActiveEntries: boolean } {
  for (const [key, entry] of cache.entries()) {
    if (entry.durationMs > 0) {
      cache.set(key, {
        ...entry,
        expiresAt: Math.max(entry.expiresAt, now + entry.durationMs),
      });
    } else if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  return pruneExpiredVolatileKeyringEntries(cache, now, false);
}

export const touchVolatileKeyringEntriesOnSessionIdle =
  touchVolatileKeyringEntriesOnReaderClose;

export function resolveVolatileKeyringCandidatePassphrases(
  cache: Map<string, VolatileKeyringCacheEntry>,
  options: {
    preferredCacheKey?: string | null;
    now?: number;
    isReaderOpen?: boolean;
  } = {}
): Array<{ cacheKey: string; passphrase: string; durationMs: number }> {
  const { preferredCacheKey, now = Date.now(), isReaderOpen = false } = options;
  pruneExpiredVolatileKeyringEntries(cache, now, isReaderOpen);

  const ordered: Array<{ cacheKey: string; passphrase: string; durationMs: number }> = [];
  const seenPassphrases = new Set<string>();

  if (preferredCacheKey) {
    const exact = cache.get(preferredCacheKey);
    if (exact && exact.passphrase) {
      ordered.push({
        cacheKey: preferredCacheKey,
        passphrase: exact.passphrase,
        durationMs: exact.durationMs,
      });
      seenPassphrases.add(exact.passphrase);
    }
  }

  for (const [cacheKey, entry] of cache.entries()) {
    if (!entry.passphrase || seenPassphrases.has(entry.passphrase)) continue;
    seenPassphrases.add(entry.passphrase);
    ordered.push({
      cacheKey,
      passphrase: entry.passphrase,
      durationMs: entry.durationMs,
    });
  }

  return ordered;
}

export interface VolatileKeyringCacheOptions {
  defaultTtlMs?: number;
  isSessionActive?: () => boolean;
  bindPageHide?: boolean;
  onAutoLock?: () => void;
}

export class VolatileKeyringCache {
  readonly entries = new Map<string, VolatileKeyringCacheEntry>();
  private readonly defaultTtlMs: number;
  private readonly isSessionActive: () => boolean;
  private readonly onAutoLock?: () => void;
  private readonly listeners = new Set<() => void>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private pageHideCleanup: (() => void) | null = null;

  constructor(options: VolatileKeyringCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_VOLATILE_KEYRING_TTL_MS;
    this.isSessionActive = options.isSessionActive ?? (() => false);
    this.onAutoLock = options.onAutoLock;

    if (
      options.bindPageHide &&
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { addEventListener?: unknown }).addEventListener === 'function'
    ) {
      const target = globalThis as unknown as {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      };
      const onPageHide = () => {
        this.clear();
      };
      target.addEventListener('pagehide', onPageHide);
      this.pageHideCleanup = () => {
        target.removeEventListener('pagehide', onPageHide);
      };
    }
  }

  get size(): number {
    return this.entries.size;
  }

  hasActiveEntries(now: number = Date.now()): boolean {
    const prevSize = this.entries.size;
    const { hasActiveEntries } = pruneExpiredVolatileKeyringEntries(
      this.entries,
      now,
      this.isSessionActive()
    );
    if (this.entries.size !== prevSize) {
      if (this.entries.size === 0) {
        this.clearTimer();
      }
      this.notify();
    }
    return hasActiveEntries;
  }

  get(cacheKey: string): VolatileKeyringCacheEntry | undefined {
    return this.entries.get(cacheKey);
  }

  upsert(
    cacheKey: string,
    passphrase: string,
    durationMs: number = this.defaultTtlMs,
    now: number = Date.now()
  ): { nextExpiryDelayMs: number | null; hasActiveEntries: boolean } {
    const result = upsertVolatileKeyringEntry(
      this.entries,
      cacheKey,
      passphrase,
      durationMs,
      now,
      this.isSessionActive()
    );
    this.scheduleExpiryCheck(result.nextExpiryDelayMs);
    this.notify();
    return result;
  }

  delete(cacheKey: string): boolean {
    const deleted = this.entries.delete(cacheKey);
    if (this.entries.size === 0) {
      this.clearTimer();
    }
    if (deleted) {
      this.notify();
    }
    return deleted;
  }

  clear(): void {
    const hadEntries = this.entries.size > 0;
    this.entries.clear();
    this.clearTimer();
    if (hadEntries) {
      this.notify();
    }
  }

  touchOnSessionIdle(
    now: number = Date.now()
  ): { nextExpiryDelayMs: number | null; hasActiveEntries: boolean } {
    if (this.entries.size === 0) {
      return { nextExpiryDelayMs: null, hasActiveEntries: false };
    }
    const result = touchVolatileKeyringEntriesOnReaderClose(this.entries, now);
    if (!result.hasActiveEntries) {
      this.clear();
      return result;
    }
    this.scheduleExpiryCheck(result.nextExpiryDelayMs);
    this.notify();
    return result;
  }

  resolveCandidates(
    preferredCacheKey?: string | null,
    now: number = Date.now()
  ): Array<{ cacheKey: string; passphrase: string; durationMs: number }> {
    const prevSize = this.entries.size;
    const result = resolveVolatileKeyringCandidatePassphrases(this.entries, {
      preferredCacheKey,
      now,
      isReaderOpen: this.isSessionActive(),
    });
    if (this.entries.size !== prevSize) {
      if (this.entries.size === 0) {
        this.clearTimer();
      }
      this.notify();
    }
    return result;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.clearTimer();
    this.entries.clear();
    if (this.pageHideCleanup) {
      this.pageHideCleanup();
      this.pageHideCleanup = null;
    }
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private clearTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private scheduleExpiryCheck(delayMs: number | null): void {
    this.clearTimer();
    if (delayMs === null) return;

    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      if (this.isSessionActive()) {
        this.scheduleExpiryCheck(60_000);
        return;
      }
      const { nextExpiryDelayMs, hasActiveEntries } = pruneExpiredVolatileKeyringEntries(
        this.entries,
        Date.now(),
        false
      );
      if (!hasActiveEntries) {
        this.notify();
        this.onAutoLock?.();
        return;
      }
      this.scheduleExpiryCheck(nextExpiryDelayMs);
    }, Math.max(1_000, delayMs));
    (this.expiryTimer as { unref?: () => void }).unref?.();
  }
}
