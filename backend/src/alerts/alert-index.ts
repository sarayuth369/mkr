import { supabaseConfigFrom, supabaseSelect } from '../supabase/supabase-client';
import type { Env } from '../types';
import type { AlertRow } from './types';

const ALERT_INDEX_KEY = 'alerts:index';
// Comfortably longer than the cron refresh period (1 minute, see
// wrangler.toml [triggers]) so a single missed/slow cron tick doesn't blank
// out the index; short enough that a newly-created alert starts evaluating
// within a couple of minutes at most.
const ALERT_INDEX_TTL_SECONDS = 180;

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
 */
export async function refreshAlertIndex(env: Env): Promise<AlertIndex | null> {
  const config = supabaseConfigFrom(env);
  if (!config) return null; // Supabase not configured - alert engine stays disabled

  const rows = await supabaseSelect<AlertRow>(config, 'alerts', '?enabled=eq.true&select=*');
  const bySymbol: Record<string, AlertRow[]> = {};
  for (const row of rows) {
    (bySymbol[row.symbol] ??= []).push(row);
  }
  const index: AlertIndex = { bySymbol, builtAt: Date.now() };
  await env.MKR_CACHE.put(ALERT_INDEX_KEY, JSON.stringify(index), { expirationTtl: ALERT_INDEX_TTL_SECONDS });
  return index;
}

export async function getAlertIndex(env: Env): Promise<AlertIndex | null> {
  return env.MKR_CACHE.get<AlertIndex>(ALERT_INDEX_KEY, 'json');
}
