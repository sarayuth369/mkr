// KV-backed response cache with per-isolate in-flight request de-duplication.
//
// Two layers of "don't call the provider twice":
//  1. KV cache (durable, shared across isolates/regions, TTL-based) - the
//     primary defense against the "100 users request AAPL simultaneously"
//     case from the spec.
//  2. An in-memory in-flight map (per isolate only) - collapses concurrent
//     cache-miss requests hitting the SAME isolate into one upstream call.
//
// KV has no compare-and-swap, so two DIFFERENT isolates can both miss the
// cache at the exact same instant and each make one upstream call - an
// accepted tradeoff (bounded to "a small constant number of extra calls",
// never "one call per user"). A Durable-Object-based single-flight lock
// would close that gap fully; not built here to avoid overengineering an
// early-stage product - see docs/MKR-PHASE2-ARCHITECTURE.md.

import { safeKvPut } from '../kv-safety';

// Cloudflare KV rejects any `expirationTtl` under 60 seconds outright (a
// hard platform floor, confirmed against the real API during deployment -
// not a soft/advisory limit) - clamped here so a short TTL request fails
// gracefully by rounding up rather than throwing a KV write error.
const KV_MIN_TTL_SECONDS = 60;

const inFlight = new Map<string, Promise<unknown>>();

export interface CacheResult<T> {
  value: T;
  cached: boolean;
}

// A cache-miss result can legitimately be `null` (e.g. a healthy-but-empty
// quote), which is indistinguishable from "not cached" if stored bare - KV
// returns `null` for both a missing key and a stored JSON `null`. Wrapping
// in an envelope makes "cached null" and "not cached" distinguishable.
interface CacheEnvelope<T> {
  v: T;
}

export async function cachedFetch<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<CacheResult<T>> {
  const cached = await kv.get<CacheEnvelope<T>>(key, 'json');
  if (cached) {
    return { value: cached.v, cached: true };
  }

  const pending = inFlight.get(key);
  if (pending) {
    return { value: (await pending) as T, cached: false };
  }

  const promise = (async (): Promise<T> => {
    const value = await fetcher();
    const envelope: CacheEnvelope<T> = { v: value };
    // Best-effort: the fetch already succeeded, so a cache-write failure
    // (e.g. KV quota exhausted) must not fail the caller's request - see
    // kv-safety.ts.
    await safeKvPut(kv, key, JSON.stringify(envelope), { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.floor(ttlSeconds)) }, 'cachedFetch');
    return value;
  })();

  inFlight.set(key, promise);
  try {
    return { value: await promise, cached: false };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * General-purpose single-flight coalescing, sharing the same per-isolate
 * `inFlight` map as [cachedFetch] above but for callers that manage their
 * own KV read/write (e.g. handleQuotes' batch path, which reads/writes
 * several cache keys at once and can't express itself as one [cachedFetch]
 * call). Fixes the verified gap where handleQuotes bypassed in-flight
 * dedup entirely - concurrent identical batch requests each independently
 * called the provider (Decision 7, Phase 5). Callers should build `key`
 * from the exact request shape (e.g. the sorted uncached-symbol list) so
 * only genuinely-equivalent concurrent requests coalesce.
 */
export async function coalesced<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

// The 'quote' key was versioned to 'quote:v2' as part of the Task 4 cache-
// correctness fix: handleQuote used to cache `{quote, source}` under plain
// `quote:<SYMBOL>` while handleQuotes cached/read a bare NormalizedQuote
// under the exact same key - whichever route wrote last "poisoned" the
// other's read within the TTL window (reproduced live in the Task 3 audit).
// Both routes now cache the identical bare-NormalizedQuote shape (source is
// already a field on NormalizedQuote itself, so nothing was lost), which
// makes them safely shareable rather than merely non-colliding - a `/quote`
// call and a `/quotes` call for the same symbol now reuse one cache entry
// instead of each needing its own. The version bump guarantees zero
// old-shape reads immediately after deploy: any entry still sitting under
// the old unversioned `quote:<SYMBOL>` key is simply never read again and
// ages out on its own TTL (cache is ephemeral - no active migration
// needed). candles/status keys are untouched; only 'quote' ever had this
// collision.
export function cacheKey(kind: 'quote' | 'candles' | 'status', symbol: string, extra = ''): string {
  const prefix = kind === 'quote' ? 'quote:v2' : kind;
  return `${prefix}:${symbol}${extra ? `:${extra}` : ''}`;
}

/** Read-only cache lookup, for callers doing their own batched fetch on a miss (see handleQuotes). */
export async function getCached<T>(kv: KVNamespace, key: string): Promise<T | undefined> {
  const cached = await kv.get<CacheEnvelope<T>>(key, 'json');
  return cached ? cached.v : undefined;
}

/** Write-only cache population, paired with [getCached] for a caller that fetched a whole batch itself in one upstream call. */
export async function putCached<T>(kv: KVNamespace, key: string, value: T, ttlSeconds: number): Promise<void> {
  const envelope: CacheEnvelope<T> = { v: value };
  await safeKvPut(kv, key, JSON.stringify(envelope), { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.floor(ttlSeconds)) }, 'putCached');
}

/** Test-only: clears the in-flight map between test cases. */
export function _resetInFlightForTests(): void {
  inFlight.clear();
}
