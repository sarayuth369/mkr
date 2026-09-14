import { logError } from './logging';

/**
 * Wraps a non-essential KV write (response cache, alert-index snapshot) so
 * a KV failure - most notably a 429 once the daily PUT quota is exhausted -
 * degrades to "this write didn't happen" instead of throwing an uncaught
 * exception. Before this wrapper existed, `cachedFetch`'s unguarded
 * `kv.put()` meant a quota-exhausted cache write turned an otherwise
 * successful market-data fetch into a hard 500 for the caller (see
 * docs/architecture/MKR_MARKET_DATA_ARCHITECTURE_DECISIONS.md, Phase 0.C).
 *
 * Only for writes where the caller already has the correct value in hand
 * and can safely proceed without the write landing - never use this to
 * swallow a write whose success the caller actually depends on (e.g. admin
 * config saves in config-service.ts, which intentionally still throw so the
 * admin sees the failure).
 */
export async function safeKvPut(
  kv: KVNamespace,
  key: string,
  value: string,
  options: KVNamespacePutOptions | undefined,
  context: string,
): Promise<boolean> {
  try {
    await kv.put(key, value, options);
    return true;
  } catch (err) {
    logError('non-essential KV write failed - degraded, not fatal', { key, context, message: (err as Error).message });
    return false;
  }
}
