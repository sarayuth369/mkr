import type { Env } from '../types';
import type { CalendarEventFilters, CalendarSourceState, EconomicEvent, EventImportance, EventStatus } from './types';

interface EconomicEventRow {
  id: string;
  source: string;
  source_event_id: string;
  country: string;
  currency: string | null;
  title: string;
  category: string;
  event_time_utc: number;
  importance: string;
  previous: number | null;
  consensus: number | null;
  actual: number | null;
  unit: string | null;
  status: string;
  related_assets: string;
  source_url: string | null;
  updated_at: number;
}

function rowToEvent(row: EconomicEventRow): EconomicEvent {
  let relatedAssets: string[] = [];
  try {
    const parsed = JSON.parse(row.related_assets);
    if (Array.isArray(parsed)) relatedAssets = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    relatedAssets = [];
  }
  return {
    id: row.id,
    source: row.source,
    sourceEventId: row.source_event_id,
    country: row.country,
    currency: row.currency,
    title: row.title,
    category: row.category,
    eventTimeUtc: row.event_time_utc,
    // eventTimeLocal is a display-only derived value, recomputed here
    // rather than stored - see calendar-routes.ts for why this file
    // itself does not import timezone.ts (kept storage-layer pure/D1-only).
    eventTimeLocal: '',
    importance: (row.importance as EventImportance) ?? 'unknown',
    previous: row.previous,
    consensus: row.consensus,
    actual: row.actual,
    unit: row.unit,
    status: (row.status as EventStatus) ?? 'unknown',
    relatedAssets,
    sourceUrl: row.source_url,
    updatedAt: row.updated_at,
  };
}

/**
 * D1-backed canonical Economic Calendar store. The upsert is the one place
 * "preserve known-good actual/consensus/previous when a later source
 * response omits them" (task constraint) is enforced - `COALESCE(excluded.x, economic_events.x)`
 * keeps the EXISTING value whenever the new value is NULL, for every
 * numeric field, so a later ingestion that genuinely doesn't have a value
 * yet can never blow away a value a previous ingestion already recorded.
 * `title`/`category`/`importance`/`related_assets`/`source_url` DO get
 * overwritten unconditionally - those are schedule/classification
 * metadata, not "a value that might not have arrived yet", so the latest
 * ingestion's version is correct by definition (e.g. a title correction).
 */
export class CalendarStore {
  constructor(private readonly db: D1Database) {}

  async upsertMany(events: EconomicEvent[]): Promise<void> {
    // D1's batch() runs every statement in one round-trip; still one
    // prepared statement per event (no multi-row VALUES support needed at
    // this scale - the curated dataset plus any future live provider's
    // near-term window is at most a few hundred rows, never per-tick).
    const statements = events.map((event) =>
      this.db
        .prepare(
          `INSERT INTO economic_events
             (id, source, source_event_id, country, currency, title, category, event_time_utc, importance, previous, consensus, actual, unit, status, related_assets, source_url, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             country=excluded.country,
             currency=excluded.currency,
             title=excluded.title,
             category=excluded.category,
             event_time_utc=excluded.event_time_utc,
             importance=excluded.importance,
             previous=COALESCE(excluded.previous, economic_events.previous),
             consensus=COALESCE(excluded.consensus, economic_events.consensus),
             actual=COALESCE(excluded.actual, economic_events.actual),
             unit=COALESCE(excluded.unit, economic_events.unit),
             status=excluded.status,
             related_assets=excluded.related_assets,
             source_url=excluded.source_url,
             updated_at=excluded.updated_at`,
        )
        .bind(
          event.id,
          event.source,
          event.sourceEventId,
          event.country,
          event.currency,
          event.title,
          event.category,
          event.eventTimeUtc,
          event.importance,
          event.previous,
          event.consensus,
          event.actual,
          event.unit,
          event.status,
          JSON.stringify(event.relatedAssets),
          event.sourceUrl,
          event.updatedAt,
        ),
    );
    if (statements.length === 0) return;
    await this.db.batch(statements);
  }

  async query(filters: CalendarEventFilters): Promise<EconomicEvent[]> {
    const clauses: string[] = [];
    const args: unknown[] = [];

    if (filters.fromInstant || filters.toInstant) {
      // 2026-09-16 Closed Testing readiness task (root cause): exact
      // caller-supplied UTC instants - takes precedence over date/from/to's
      // UTC-CALENDAR-DAY reinterpretation (see CalendarEventFilters' doc
      // comment). Used by the Flutter client so "Today"/"Tomorrow"/"This
      // Week" bucket by the DEVICE's actual local day/week, not UTC's.
      if (filters.fromInstant) {
        clauses.push('event_time_utc >= ?');
        args.push(Date.parse(filters.fromInstant));
      }
      if (filters.toInstant) {
        clauses.push('event_time_utc < ?');
        args.push(Date.parse(filters.toInstant));
      }
    } else if (filters.date) {
      const from = Date.parse(`${filters.date}T00:00:00Z`);
      const to = from + 24 * 60 * 60 * 1000;
      clauses.push('event_time_utc >= ? AND event_time_utc < ?');
      args.push(from, to);
    } else {
      if (filters.from) {
        clauses.push('event_time_utc >= ?');
        args.push(Date.parse(`${filters.from}T00:00:00Z`));
      }
      if (filters.to) {
        clauses.push('event_time_utc < ?');
        args.push(Date.parse(`${filters.to}T00:00:00Z`) + 24 * 60 * 60 * 1000);
      }
    }
    if (filters.country) {
      clauses.push('country = ?');
      args.push(filters.country.toUpperCase());
    }
    if (filters.currency) {
      clauses.push('currency = ?');
      args.push(filters.currency.toUpperCase());
    }
    if (filters.importance) {
      clauses.push('importance = ?');
      args.push(filters.importance);
    }
    if (filters.category) {
      clauses.push('category = ?');
      args.push(filters.category);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { results } = await this.db
      .prepare(`SELECT * FROM economic_events ${where} ORDER BY event_time_utc ASC`)
      .bind(...args)
      .all<EconomicEventRow>();
    return (results ?? []).map(rowToEvent);
  }

  async sourceState(source: string): Promise<CalendarSourceState | null> {
    const row = await this.db
      .prepare('SELECT * FROM calendar_source_state WHERE source = ?')
      .bind(source)
      .first<{ source: string; last_success_at: number | null; last_failure_at: number | null; last_error_message: string | null; last_event_count: number }>();
    if (!row) return null;
    return {
      source: row.source,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lastErrorMessage: row.last_error_message,
      lastEventCount: row.last_event_count,
    };
  }

  async allSourceStates(): Promise<CalendarSourceState[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM calendar_source_state ORDER BY source ASC')
      .all<{ source: string; last_success_at: number | null; last_failure_at: number | null; last_error_message: string | null; last_event_count: number }>();
    return (results ?? []).map((row) => ({
      source: row.source,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lastErrorMessage: row.last_error_message,
      lastEventCount: row.last_event_count,
    }));
  }

  async recordSourceSuccess(source: string, eventCount: number, now: number = Date.now()): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO calendar_source_state (source, last_success_at, last_failure_at, last_error_message, last_event_count, updated_at)
         VALUES (?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(source) DO UPDATE SET last_success_at=excluded.last_success_at, last_error_message=NULL, last_event_count=excluded.last_event_count, updated_at=excluded.updated_at`,
      )
      .bind(source, now, eventCount, now)
      .run();
  }

  async recordSourceFailure(source: string, errorMessage: string, now: number = Date.now()): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO calendar_source_state (source, last_success_at, last_failure_at, last_error_message, last_event_count, updated_at)
         VALUES (?, NULL, ?, ?, 0, ?)
         ON CONFLICT(source) DO UPDATE SET last_failure_at=excluded.last_failure_at, last_error_message=excluded.last_error_message, updated_at=excluded.updated_at`,
      )
      .bind(source, now, errorMessage, now)
      .run();
  }
}

export function calendarStoreFor(env: Env): CalendarStore {
  return new CalendarStore(env.MKR_DB);
}
