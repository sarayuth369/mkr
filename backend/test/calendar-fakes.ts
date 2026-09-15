// A faithful in-memory D1 fake for economic_events + calendar_source_state -
// implements the SAME upsert semantics (INSERT ... ON CONFLICT DO UPDATE
// SET x = COALESCE(excluded.x, table.x) for numeric fields, unconditional
// overwrite for metadata) the real schema.sql/store.ts SQL expresses, since
// this codebase's existing D1 test fakes (test/fakes.ts, market-routes-
// quote-cache.test.ts) don't execute real SQL either - they simulate the
// documented contract. Real D1 SQL syntax correctness itself should still
// be verified against a live D1 database (`wrangler d1 execute --local`)
// before/at first production use - documented as a known limitation in the
// final report, not hidden. Shared by calendar-store.test.ts,
// calendar-ingestion.test.ts, and calendar-routes.test.ts.

interface EventRow {
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

interface SourceStateRow {
  source: string;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_error_message: string | null;
  last_event_count: number;
  updated_at: number;
}

export function createFakeCalendarD1() {
  const events = new Map<string, EventRow>();
  const sourceStates = new Map<string, SourceStateRow>();

  function upsertEvent(args: unknown[]): void {
    const [id, source, source_event_id, country, currency, title, category, event_time_utc, importance, previous, consensus, actual, unit, status, related_assets, source_url, updated_at] =
      args as [string, string, string, string, string | null, string, string, number, string, number | null, number | null, number | null, string | null, string, string, string | null, number];
    const existing = events.get(id);
    events.set(id, {
      id,
      source,
      source_event_id,
      country,
      currency,
      title,
      category,
      event_time_utc,
      importance,
      previous: previous === null ? (existing?.previous ?? null) : previous,
      consensus: consensus === null ? (existing?.consensus ?? null) : consensus,
      actual: actual === null ? (existing?.actual ?? null) : actual,
      unit: unit === null ? (existing?.unit ?? null) : unit,
      status,
      related_assets,
      source_url,
      updated_at,
    });
  }

  // Mirrors each real statement's exact bind() arg list AND its exact
  // `ON CONFLICT DO UPDATE SET` column list - store.ts's SQL uses literal
  // NULL/0 (not `?` placeholders) for the columns each method doesn't
  // supply, so recordSourceSuccess binds only (source, now, eventCount,
  // now) and recordSourceFailure only (source, now, errorMessage, now) -
  // 4 args each, not 6. A column not named in the real SET clause is
  // untouched by a real SQLite upsert, so this must preserve exactly what
  // that real SQL preserves.
  function upsertSourceState(args: unknown[], kind: 'success' | 'failure'): void {
    const existing = sourceStates.get(args[0] as string);
    if (kind === 'success') {
      const [source, last_success_at, last_event_count, updated_at] = args as [string, number, number, number];
      sourceStates.set(source, {
        source,
        last_success_at,
        last_failure_at: existing?.last_failure_at ?? null,
        last_error_message: null,
        last_event_count,
        updated_at,
      });
    } else {
      const [source, last_failure_at, last_error_message, updated_at] = args as [string, number, string, number];
      sourceStates.set(source, {
        source,
        last_success_at: existing?.last_success_at ?? null,
        last_failure_at,
        last_error_message,
        last_event_count: existing?.last_event_count ?? 0,
        updated_at,
      });
    }
  }

  function db() {
    return {
      prepare(sql: string) {
        let boundArgs: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return this;
          },
          async run() {
            if (sql.includes('INSERT INTO economic_events')) upsertEvent(boundArgs);
            else if (sql.includes('INSERT INTO calendar_source_state') && sql.includes('last_success_at, last_failure_at, last_error_message')) {
              upsertSourceState(boundArgs, sql.includes('VALUES (?, ?, NULL, NULL') ? 'success' : 'failure');
            }
            return { success: true, meta: {} };
          },
          async first<T>() {
            if (sql.includes('FROM calendar_source_state WHERE source')) {
              const row = sourceStates.get(boundArgs[0] as string);
              return (row ?? null) as T | null;
            }
            return null;
          },
          async all<T>() {
            if (sql.includes('FROM economic_events')) {
              let rows = [...events.values()];
              // Mirror store.ts's WHERE-clause construction order exactly
              // enough for these tests' filter combinations (date/from/to,
              // country, currency, importance, category) - a pragmatic
              // fake, not a SQL engine.
              const argsQueue = [...boundArgs];
              if (sql.includes('event_time_utc >= ? AND event_time_utc < ?')) {
                const from = argsQueue.shift() as number;
                const to = argsQueue.shift() as number;
                rows = rows.filter((r) => r.event_time_utc >= from && r.event_time_utc < to);
              } else {
                if (sql.includes('event_time_utc >= ?')) {
                  const from = argsQueue.shift() as number;
                  rows = rows.filter((r) => r.event_time_utc >= from);
                }
                if (sql.includes('event_time_utc < ?')) {
                  const to = argsQueue.shift() as number;
                  rows = rows.filter((r) => r.event_time_utc < to);
                }
              }
              if (sql.includes('country = ?')) {
                const country = argsQueue.shift() as string;
                rows = rows.filter((r) => r.country === country);
              }
              if (sql.includes('currency = ?')) {
                const currency = argsQueue.shift() as string;
                rows = rows.filter((r) => r.currency === currency);
              }
              if (sql.includes('importance = ?')) {
                const importance = argsQueue.shift() as string;
                rows = rows.filter((r) => r.importance === importance);
              }
              if (sql.includes('category = ?')) {
                const category = argsQueue.shift() as string;
                rows = rows.filter((r) => r.category === category);
              }
              rows.sort((a, b) => a.event_time_utc - b.event_time_utc);
              return { results: rows as T[], success: true, meta: {} };
            }
            if (sql.includes('FROM calendar_source_state')) {
              const rows = [...sourceStates.values()].sort((a, b) => a.source.localeCompare(b.source));
              return { results: rows as T[], success: true, meta: {} };
            }
            return { results: [] as T[], success: true, meta: {} };
          },
        };
      },
      async batch(statements: { run(): Promise<unknown> }[]) {
        const results = [];
        for (const s of statements) results.push(await s.run());
        return results;
      },
    } as unknown as D1Database;
  }

  return { db: db(), events, sourceStates };
}
