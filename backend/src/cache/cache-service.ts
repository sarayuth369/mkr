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
    await kv.put(key, JSON.stringify(envelope), { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.floor(ttlSeconds)) });
    return value;
  })();

  inFlight.set(key, promise);
  try {
    return { value: await promise, cached: false };
  } finally {
    inFlight.delete(key);
  }
}

export function cacheKey(kind: 'quote' | 'candles' | 'status', symbol: string, extra = ''): string {
  return `${kind}:${symbol}${extra ? `:${extra}` : ''}`;
}

/** Read-only cache lookup, for callers doing their own batched fetch on a miss (see handleQuotes). */
export async function getCached<T>(kv: KVNamespace, key: string): Promise<T | undefined> {
  const cached = await kv.get<CacheEnvelope<T>>(key, 'json');
  return cached ? cached.v : undefined;
}

/** Write-only cache population, paired with [getCached] for a caller that fetched a whole batch itself in one upstream call. */
export async function putCached<T>(kv: KVNamespace, key: string, value: T, ttlSeconds: number): Promise<void> {
  const envelope: CacheEnvelope<T> = { v: value };
  await kv.put(key, JSON.stringify(envelope), { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.floor(ttlSeconds)) });
}

/** Test-only: clears the in-flight map between test cases. */
export function _resetInFlightForTests(): void {
  inFlight.clear();
}
