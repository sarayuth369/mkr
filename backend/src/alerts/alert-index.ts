import { safeKvPut } from '../kv-safety';
import { supabaseConfigFrom, supabaseSelect } from '../supabase/supabase-client';
import type { Env } from '../types';
import type { AlertRow } from './types';

const ALERT_INDEX_KEY = 'alerts:index';
// Long enough that the KEEPALIVE_INTERVAL_MS refresh below (which is what
// actually keeps the entry alive - see refreshAlertIndex) always lands
// comfortably before expiry, even if one cron tick is slow/missed.
const ALERT_INDEX_TTL_SECONDS = 600;
// The cron still runs every minute (wrangler.toml [triggers]) and always
// re-queries Supabase, so an actual alert change is still detected and
// written within a minute - unchanged, this constant only bounds how often
// an UNCHANGED index is re-written purely to refresh its TTL. Half of
// ALERT_INDEX_TTL_SECONDS, so a single missed tick still can't let the key
// expire before the next keepalive is due.
const KEEPALIVE_INTERVAL_MS = 300_000;

export interface AlertIndex {
  bySymbol: Record<string, AlertRow[]>;
  builtAt: number;
}

/**
 * The "cached/indexed boundary" the spec calls for: evaluating every market
 * tick against Supabase directly would mean one Supabase query per tick per
 * symbol (potentially per second, for every active symbol) - this instead
 * refreshes a KV snapshot on a 1-minute Cron Trigger (see the `scheduled`
 * export in index.ts) and [evaluateTick] in alert-engine.ts reads ONLY this
 * KV snapshot, never Supabase directly.
 *
 * Scalability path (documented per spec, not built now - avoids
 * overengineering an early-stage product): once alert volume grows past
 * what fits in one KV value, shard the index by symbol
 * (`alerts:index:<SYMBOL>`) so a tick only reads its own symbol's key, or
 * move to a Durable-Object-held index with push-based invalidation from a
 * Supabase webhook instead of polling. See docs/MKR-PHASE2-ARCHITECTURE.md.
 *
 * KV write is skipped unless the fetched alert set actually changed, OR the
 * last write is old enough that skipping again would risk the TTL lapsing
 * (see KEEPALIVE_INTERVAL_MS) - this is the Phase 0.A fix for the KV PUT
 * quota incident: the old unconditional every-tick write guaranteed 1,440
 * writes/day on its own, exceeding the free-tier 1,000/day quota with zero
 * app traffic. The cron still runs every minute and still always queries
 * Supabase (a read, not a KV write), so a genuine alert change is still
 * reflected within a minute - only the redundant unchanged writes are cut.
 */
export async function refreshAlertIndex(env: Env): Promise<AlertIndex | null> {
  const config = supabaseConfigFrom(env);
  if (!config) return null; // Supabase not configured - alert engine stays disabled

  const rows = await supabaseSelect<AlertRow>(config, 'alerts', '?enabled=eq.true&select=*');
  const bySymbol: Record<string, AlertRow[]> = {};
  for (const row of rows) {
    (bySymbol[row.symbol] ??= []).push(row);
  }
  const serializedBySymbol = JSON.stringify(bySymbol);

  const existing = await env.MKR_CACHE.get<AlertIndex>(ALERT_INDEX_KEY, 'json');
  if (existing) {
    const unchanged = JSON.stringify(existing.bySymbol) === serializedBySymbol;
    const dueForKeepalive = Date.now() - existing.builtAt >= KEEPALIVE_INTERVAL_MS;
    if (unchanged && !dueForKeepalive) return existing; // no-op: content identical, TTL still has headroom
  }

  const index: AlertIndex = { bySymbol, builtAt: Date.now() };
  await safeKvPut(env.MKR_CACHE, ALERT_INDEX_KEY, JSON.stringify(index), { expirationTtl: ALERT_INDEX_TTL_SECONDS }, 'refreshAlertIndex');
  return index;
}

export async function getAlertIndex(env: Env): Promise<AlertIndex | null> {
  return env.MKR_CACHE.get<AlertIndex>(ALERT_INDEX_KEY, 'json');
}
