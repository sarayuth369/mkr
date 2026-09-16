/**
 * Canonical Economic Calendar model (GPT hybrid-architecture task,
 * 2026-09-15) - provider-neutral, source-independent. Every collector
 * (official-source curated schedules today; FXStreet/FMP/Finnhub/Trading
 * Economics as future, rights-gated providers) normalizes into this shape;
 * nothing downstream (D1, cache, API, Flutter) ever sees a provider's own
 * response shape.
 *
 * All numeric fields are nullable and MUST stay null when the source
 * doesn't supply them - never fabricated, never defaulted to 0 (see
 * EconomicCalendarProvider's doc comment for the full "why").
 */

export type EventImportance = 'high' | 'medium' | 'low' | 'unknown';

export type EventStatus = 'scheduled' | 'released' | 'cancelled' | 'unknown';

export interface EconomicEvent {
  /** Deterministic, stable across re-ingestion: `${source}:${sourceEventId}`. */
  id: string;
  /** Provider/collector id, e.g. "curated_official", "fmp". */
  source: string;
  /** The identity of this event WITHIN its source - stable across repeated
   * ingestion so re-fetching never creates a duplicate row (see
   * ingestion.ts). For a curated source this is a hand-assigned slug
   * (e.g. "fomc-2026-03-18"); for a live provider it's whatever stable id
   * (or deterministic composite) that provider's own data exposes. */
  sourceEventId: string;

  /** ISO 3166-1 alpha-2 where meaningful, or a currency-area code (e.g. "EU"). */
  country: string;
  /** ISO 4217 currency code most associated with this event, or null if not applicable. */
  currency: string | null;

  title: string;
  /** MKR-owned classification (src/calendar/classification.ts) - never a
   * copied commercial-provider label. */
  category: string;

  /** Epoch ms, UTC. */
  eventTimeUtc: number;
  /** ISO-8601 local wall-clock string (no UTC 'Z'/offset) in the event's
   * own country/timezone - display convenience only; eventTimeUtc is
   * authoritative. */
  eventTimeLocal: string;

  importance: EventImportance;

  previous: number | null;
  consensus: number | null;
  actual: number | null;
  /** e.g. "%", "K", "B" - null when the source gives no unit or the value itself is null. */
  unit: string | null;

  status: EventStatus;

  /** MKR internal symbols this event is relevant to (src/calendar/classification.ts) - metadata only, never a trading signal. */
  relatedAssets: string[];

  /** Link to the source's own page for this event/release, when the source provides one. */
  sourceUrl: string | null;

  /** Epoch ms - when THIS row was last written by ingestion (not the source's own "last modified", which most sources here don't expose). */
  updatedAt: number;
}

export interface CalendarEventFilters {
  /** A single calendar date, "YYYY-MM-DD" (interpreted as UTC day bounds - see calendar-routes.ts). */
  date?: string;
  from?: string; // "YYYY-MM-DD", inclusive
  to?: string; // "YYYY-MM-DD", inclusive
  /**
   * 2026-09-16 Closed Testing readiness task (root cause): exact UTC
   * instants, ISO-8601 with time (e.g. "2026-09-15T17:00:00.000Z") - an
   * inclusive/exclusive `[fromInstant, toInstant)` range, distinct from
   * `date`/`from`/`to`'s UTC-CALENDAR-DAY semantics. A client that knows
   * its own device-local day/week boundary (which almost never lines up
   * with a UTC calendar day - see store.ts's `query()`) converts that
   * local boundary to UTC instants itself and sends the exact range here,
   * instead of relying on this backend to guess/reinterpret a bare date as
   * a UTC day. Takes precedence over `date`/`from`/`to` when present (see
   * `query()`). `date`/`from`/`to` are unchanged for every existing caller
   * that genuinely wants a UTC-day bucket (e.g. `/today`/`/week`'s own
   * UTC-day convenience routes, admin tooling).
   */
  fromInstant?: string;
  toInstant?: string;
  country?: string;
  currency?: string;
  importance?: EventImportance;
  category?: string;
}

/** Centralized freshness/source-state policy (see freshness.ts). Never call cached/canonical data LIVE merely because it exists - LIVE requires an actually-recent successful ingestion. */
export type CalendarFreshness = 'live' | 'stale' | 'degraded' | 'offline';

export interface CalendarSourceState {
  source: string;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorMessage: string | null;
  lastEventCount: number;
}

export interface CalendarResponseMeta {
  freshness: CalendarFreshness;
  /** Epoch ms of the most recent successful ingestion across all active sources, or null if never. */
  lastUpdatedAt: number | null;
  sources: CalendarSourceState[];
}
