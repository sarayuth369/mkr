import { logInfo } from '../logging';
import type { Env } from '../types';
import { CuratedScheduleProvider } from './providers/curated-provider';
import { FmpCalendarProvider } from './providers/fmp-provider';
import { EconomicCalendarProviderManager, activeProviderIds } from './provider-manager';
import { calendarStoreFor } from './store';

// How far forward (and slightly back, for "recently released" context) an
// ingestion run fetches - bounded so this never becomes an unbounded
// full-history sync. 90 days matches FMP's own documented from/to range
// cap (see fmp-provider.ts), and comfortably covers every curated event a
// "Today / Tomorrow / This Week" calendar UI needs.
const INGEST_WINDOW_BACK_MS = 3 * 24 * 60 * 60 * 1000; // 3 days back
const INGEST_WINDOW_FORWARD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days forward

/** Config knob - which providers, beyond the always-on curated schedule, ingestion should query. Empty by default (no commercial provider active this task - see provider-manager.ts's `activeProviderIds` doc comment). */
function buildManager(env: Env, configuredProviderIds: string[]): EconomicCalendarProviderManager {
  const providers: import('./providers/types').EconomicCalendarProvider[] = [new CuratedScheduleProvider()];

  const availableCommercialIds = new Set<string>();
  if (env.FMP_API_KEY) availableCommercialIds.add('fmp');

  const ids = activeProviderIds(configuredProviderIds, availableCommercialIds);
  if (ids.includes('fmp') && env.FMP_API_KEY) providers.push(new FmpCalendarProvider(env.FMP_API_KEY));

  return new EconomicCalendarProviderManager(providers);
}

export interface IngestionResult {
  eventsUpserted: number;
  outcomes: { providerId: string; ok: boolean; eventCount: number; errorMessage: string | null }[];
}

/**
 * Idempotent ingestion (target architecture step): fetch -> validate
 * (each provider already only emits well-formed EconomicEvents) ->
 * normalize (classification applied inside each provider) -> dedupe (by
 * id, in provider-manager.ts) -> upsert D1 (preserving known-good actual/
 * consensus/previous, store.ts) -> record source state. Cache
 * invalidation is deliberately NOT push-based here (see calendar-routes.ts's
 * versioned TTL-based cache) - bounded, infrequent KV deletes only for the
 * calendar days this run actually touched, never a write-per-event.
 */
export async function runCalendarIngestion(env: Env, configuredProviderIds: string[] = [], now: number = Date.now()): Promise<IngestionResult> {
  const manager = buildManager(env, configuredProviderIds);
  const range = { fromMs: now - INGEST_WINDOW_BACK_MS, toMs: now + INGEST_WINDOW_FORWARD_MS };
  const { events, outcomes } = await manager.fetchAll(range, now);

  const store = calendarStoreFor(env);
  await store.upsertMany(events);

  for (const outcome of outcomes) {
    if (outcome.ok) await store.recordSourceSuccess(outcome.providerId, outcome.eventCount, now);
    else await store.recordSourceFailure(outcome.providerId, outcome.errorMessage ?? 'Unknown error', now);
  }

  await invalidateTouchedCacheKeys(env, events);

  logInfo('calendar ingestion complete', { eventCount: events.length, providers: outcomes.map((o) => `${o.providerId}:${o.ok ? 'ok' : 'failed'}`) });
  return { eventsUpserted: events.length, outcomes };
}

/** Bounded KV delete set: one key per distinct UTC calendar-day (and ISO week) actually touched this run - never a write/delete per event, never the whole KV namespace. */
async function invalidateTouchedCacheKeys(env: Env, events: import('./types').EconomicEvent[]): Promise<void> {
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const event of events) {
    const d = new Date(event.eventTimeUtc);
    const dayKey = d.toISOString().slice(0, 10);
    days.add(dayKey);
    weeks.add(isoWeekKey(d));
  }
  const deletions: Promise<unknown>[] = [];
  for (const day of days) deletions.push(env.MKR_CACHE.delete(`calendar:v1:day:${day}`));
  for (const week of weeks) deletions.push(env.MKR_CACHE.delete(`calendar:v1:week:${week}`));
  // Also the two fixed "today"/"this week" convenience keys calendar-routes.ts serves from.
  deletions.push(env.MKR_CACHE.delete('calendar:v1:today'), env.MKR_CACHE.delete('calendar:v1:current-week'));
  await Promise.all(deletions.map((p) => p.catch(() => undefined))); // best-effort - a failed delete just means that one key ages out on its own TTL instead
}

/** ISO-8601 week key, e.g. "2026-W38" - UTC-based (calendar bucketing consistency with event_time_utc, not exchange-local). */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
