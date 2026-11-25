import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOLATILE_KEYRING_TTL_MS,
  pruneExpiredVolatileKeyringEntries,
  resolveVolatileKeyringCandidatePassphrases,
  touchVolatileKeyringEntriesOnReaderClose,
  upsertVolatileKeyringEntry,
  VolatileKeyringCache,
  type VolatileKeyringCacheEntry,
} from '../src/index.js';

test('Volatile 15-minute RAM keyring stays unlocked across long active sessions and refreshes full 15m idle TTL on close', () => {
  const cache = new Map<string, VolatileKeyringCacheEntry>();
  const t0 = 1_700_000_000_000;

  const initial = upsertVolatileKeyringEntry(
    cache,
    'key-alpha',
    'alpha-secret-passphrase',
    DEFAULT_VOLATILE_KEYRING_TTL_MS,
    t0,
    true
  );
  assert.equal(initial.hasActiveEntries, true);
  assert.equal(initial.nextExpiryDelayMs, DEFAULT_VOLATILE_KEYRING_TTL_MS);

  // During active reading (>15m), entries must NOT expire
  const duringLongRead = pruneExpiredVolatileKeyringEntries(
    cache,
    t0 + 25 * 60_000,
    true
  );
  assert.equal(duringLongRead.hasActiveEntries, true);
  assert.equal(cache.get('key-alpha')?.passphrase, 'alpha-secret-passphrase');

  // Closing reader refreshes a full 15m idle window
  const afterClose = touchVolatileKeyringEntriesOnReaderClose(cache, t0 + 25 * 60_000);
  assert.equal(afterClose.hasActiveEntries, true);
  assert.equal(afterClose.nextExpiryDelayMs, DEFAULT_VOLATILE_KEYRING_TTL_MS);
  assert.equal(
    cache.get('key-alpha')?.expiresAt,
    t0 + 25 * 60_000 + DEFAULT_VOLATILE_KEYRING_TTL_MS
  );

  // Multi-key candidate resolution puts preferredCacheKey first
  upsertVolatileKeyringEntry(
    cache,
    'key-beta',
    'beta-secret-passphrase',
    DEFAULT_VOLATILE_KEYRING_TTL_MS,
    t0 + 26 * 60_000,
    false
  );
  const candidatesForBeta = resolveVolatileKeyringCandidatePassphrases(cache, {
    preferredCacheKey: 'key-beta',
    now: t0 + 27 * 60_000,
    isReaderOpen: false,
  });
  assert.deepEqual(
    candidatesForBeta.map((c) => c.passphrase),
    ['beta-secret-passphrase', 'alpha-secret-passphrase']
  );

  // Expires cleanly after idle timeout
  const afterIdleTimeout = pruneExpiredVolatileKeyringEntries(
    cache,
    t0 + 42 * 60_000,
    false
  );
  assert.equal(afterIdleTimeout.hasActiveEntries, false);
  assert.equal(afterIdleTimeout.nextExpiryDelayMs, null);
  assert.equal(cache.size, 0);
});

test('VolatileKeyringCache class manages subscriptions, active-session deferral, and disposal', () => {
  let sessionActive = true;
  let notifications = 0;

  const cache = new VolatileKeyringCache({
    defaultTtlMs: 60_000,
    isSessionActive: () => sessionActive,
  });

  const unsub = cache.subscribe(() => {
    notifications += 1;
  });

  const t0 = 2_000_000_000_000;
  cache.upsert('k1', 'secret-1', 60_000, t0);
  assert.equal(cache.size, 1);
  assert.equal(notifications, 1);

  // Even past TTL while active, entries remain available
  assert.equal(cache.hasActiveEntries(t0 + 120_000), true);
  assert.equal(cache.resolveCandidates('k1', t0 + 120_000).length, 1);

  // Close session -> touches TTL from idle timestamp
  sessionActive = false;
  const idleResult = cache.touchOnSessionIdle(t0 + 120_000);
  assert.equal(idleResult.hasActiveEntries, true);
  assert.equal(cache.get('k1')?.expiresAt, t0 + 180_000);

  cache.delete('k1');
  assert.equal(cache.size, 0);

  // Lazy pruning in hasActiveEntries / resolveCandidates clears expired entries and notifies listeners
  const notificationsBeforeLazyPrune = notifications;
  cache.upsert('k2', 'secret-2', 5_000, t0);
  assert.equal(cache.resolveCandidates('k2', t0 + 10_000).length, 0);
  assert.equal(cache.size, 0);
  assert.ok(notifications > notificationsBeforeLazyPrune + 1);

  const notificationsBeforeHasActive = notifications;
  cache.upsert('k3', 'secret-3', 5_000, t0);
  assert.equal(cache.hasActiveEntries(t0 + 10_000), false);
  assert.equal(cache.size, 0);
  assert.ok(notifications > notificationsBeforeHasActive + 1);

  unsub();
  cache.dispose();
});
