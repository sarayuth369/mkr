import type { CalendarFreshness, CalendarSourceState } from './types';

/**
 * Centralized freshness policy (task constraint: "Never call cached data
 * LIVE merely because it exists"). A single source of truth shared by
 * calendar-routes.ts and the admin observability route, so the two
 * surfaces can never disagree - same discipline as
 * market-stream-do.ts's `computeSymbolStatus`.
 *
 * - LIVE:     at least one source succeeded within the freshness window.
 * - STALE:    every source has succeeded at least once (so usable
 *             canonical data exists) but the most recent success is
 *             older than the freshness window - serve the data, but be
 *             honest that it's aging.
 * - DEGRADED: no source has ever succeeded, but at least one has recorded
 *             a failure (so the pipeline ran and failed, not "never ran
 *             at all") AND canonical data nonetheless exists (e.g. the
 *             curated dataset itself, which never "fails" in the network
 *             sense - see curated-provider.ts) - data is usable but a
 *             live/commercial source is unhealthy.
 * - OFFLINE:  no usable data exists at all (empty result set) - an
 *             honest empty state, never fabricated.
 */
const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h - well above the 6h ingestion cadence, so a single missed/slow cron tick doesn't flip LIVE->STALE.

export function computeFreshness(sources: CalendarSourceState[], hasEvents: boolean, now: number = Date.now()): CalendarFreshness {
  if (!hasEvents) return 'offline';

  const successTimes = sources.map((s) => s.lastSuccessAt).filter((t): t is number => t !== null);
  if (successTimes.length === 0) return 'degraded'; // data exists (e.g. curated) but nothing has ever been recorded as a successful ingestion yet

  const mostRecentSuccess = Math.max(...successTimes);
  return now - mostRecentSuccess <= FRESHNESS_WINDOW_MS ? 'live' : 'stale';
}

export function mostRecentSuccessAt(sources: CalendarSourceState[]): number | null {
  const successTimes = sources.map((s) => s.lastSuccessAt).filter((t): t is number => t !== null);
  return successTimes.length === 0 ? null : Math.max(...successTimes);
}
