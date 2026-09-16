import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetInFlightForTests } from '../src/cache/cache-service';
import { handleCalendarEvents, handleCalendarToday, handleCalendarWeek } from '../src/calendar/calendar-routes';
import type { Env } from '../src/types';
import { createFakeCalendarD1 } from './calendar-fakes';
import { createFakeKv } from './fakes';

function makeEnv(db: D1Database, calendarEnabled = true): Env {
  const config = createFakeKv();
  void config.put('runtime-config', JSON.stringify({ featureFlags: { economicCalendarEnabled: calendarEnabled } }));
  return {
    MKR_CONFIG: config,
    MKR_CACHE: createFakeKv(),
    MKR_DB: db,
    MARKET_STREAM: {} as never,
    RATE_LIMITER: {} as never,
    AI: {} as never,
    MARKET_PRIMARY_PROVIDER: 'twelve_data',
    MARKET_SECONDARY_PROVIDER: 'alpaca',
    MARKET_SECONDARY_ENABLED: 'false',
    CACHE_QUOTE_TTL_SECONDS: '60',
    CACHE_CANDLE_INTRADAY_TTL_SECONDS: '60',
    CACHE_CANDLE_DAILY_TTL_SECONDS: '600',
    CACHE_STATUS_TTL_SECONDS: '60',
    STALE_THRESHOLD_SECONDS: '90',
    RATE_LIMIT_PUBLIC_PER_MINUTE: '60',
    RATE_LIMIT_ADMIN_PER_MINUTE: '120',
    RATE_LIMIT_WS_MAX_CONNECTIONS: '500',
    ADMIN_WEB_ORIGIN: 'https://mkr-admin.pages.dev',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetInFlightForTests();
});

describe('handleCalendarEvents / handleCalendarToday / handleCalendarWeek', () => {
  it('throws FEATURE_DISABLED when economicCalendarEnabled is off', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db, false);
    await expect(handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('self-heals an empty D1 on first request - ingests the curated schedule inline, no manual step needed', async () => {
    const { db, events } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);
    const body = (await res.json()) as { success: boolean; data: { items: unknown[] } };

    expect(body.success).toBe(true);
    expect(events.size).toBeGreaterThan(0);
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it('a query that matches nothing returns an honest empty list, not an error', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?country=ZZ'), env);
    const body = (await res.json()) as { data: { items: unknown[] } };

    expect(body.data.items).toEqual([]);
  });

  it('filters by country via the query string', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?country=JP'), env);
    const body = (await res.json()) as { data: { items: { country: string }[] } };

    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) expect(item.country).toBe('JP');
  });

  it('filters by importance via the query string', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?importance=high'), env);
    const body = (await res.json()) as { data: { items: { importance: string }[] } };

    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) expect(item.importance).toBe('high');
  });

  it('rejects a malformed date filter rather than silently ignoring it', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);
    await expect(handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?date=not-a-date'), env)).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('is a cache hit on the second identical call - D1 queried once', async () => {
    const { db } = createFakeCalendarD1();
    const originalQuery = db.prepare;
    let selectCalls = 0;
    (db as unknown as { prepare: typeof db.prepare }).prepare = (sql: string) => {
      if (sql.includes('SELECT * FROM economic_events')) selectCalls++;
      return originalQuery.call(db, sql);
    };
    const env = makeEnv(db);

    await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?country=US'), env);
    const callsAfterFirst = selectCalls;
    await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?country=US'), env);

    expect(selectCalls).toBe(callsAfterFirst); // second call was a cache hit - no additional D1 query
  });

  it('/today returns only events on the current UTC date and includes freshness meta', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarToday(new Request('https://x/api/mkr/calendar/today'), env);
    const body = (await res.json()) as { data: { items: { eventTimeUtc: number }[]; meta: { freshness: string } } };

    const todayStart = new Date().toISOString().slice(0, 10);
    for (const item of body.data.items) {
      expect(new Date(item.eventTimeUtc).toISOString().slice(0, 10)).toBe(todayStart);
    }
    expect(['live', 'stale', 'degraded', 'offline']).toContain(body.data.meta.freshness);
  });

  it('/week returns only events within the current Mon-Sun UTC week', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarWeek(new Request('https://x/api/mkr/calendar/week'), env);
    const body = (await res.json()) as { data: { items: { eventTimeUtc: number }[] } };

    const now = new Date();
    const dayNum = now.getUTCDay() || 7;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayNum + 1));
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(monday.getUTCDate() + 7);

    for (const item of body.data.items) {
      expect(item.eventTimeUtc).toBeGreaterThanOrEqual(monday.getTime());
      expect(item.eventTimeUtc).toBeLessThan(nextMonday.getTime());
    }
  });

  it('every returned item has eventTimeLocal populated (not the D1-layer empty-string placeholder)', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);
    const body = (await res.json()) as { data: { items: { eventTimeLocal: string }[] } };

    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) expect(item.eventTimeLocal).not.toBe('');
  });

  it('rejects a malformed fromInstant/toInstant filter rather than silently ignoring it', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);
    await expect(handleCalendarEvents(new Request('https://x/api/mkr/calendar/events?fromInstant=not-an-instant'), env)).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('2026-09-16 Closed Testing readiness task (root cause): fromInstant/toInstant round-trips through the route into an exact-instant query, distinct from date/from/to', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    // A wide-open instant range must return the same self-healed curated
    // events an unfiltered /events call does.
    const unfiltered = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);
    const unfilteredBody = (await unfiltered.json()) as { data: { items: { id: string }[] } };

    const wideOpen = await handleCalendarEvents(
      new Request(`https://x/api/mkr/calendar/events?fromInstant=${encodeURIComponent(new Date(Date.UTC(2000, 0, 1)).toISOString())}&toInstant=${encodeURIComponent(new Date(Date.UTC(2100, 0, 1)).toISOString())}`),
      env,
    );
    const wideOpenBody = (await wideOpen.json()) as { data: { items: { id: string }[] } };
    expect(wideOpenBody.data.items.map((i) => i.id).sort()).toEqual(unfilteredBody.data.items.map((i) => i.id).sort());
    expect(wideOpenBody.data.items.length).toBeGreaterThan(0);

    // A far-future instant range genuinely matches nothing.
    const farFuture = await handleCalendarEvents(
      new Request(`https://x/api/mkr/calendar/events?fromInstant=${encodeURIComponent(new Date(Date.UTC(2100, 0, 1)).toISOString())}&toInstant=${encodeURIComponent(new Date(Date.UTC(2101, 0, 1)).toISOString())}`),
      env,
    );
    const farFutureBody = (await farFuture.json()) as { data: { items: unknown[] } };
    expect(farFutureBody.data.items).toEqual([]);
  });

  it('missing previous/consensus/actual render as null (Flutter maps this to "—", never fabricated)', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleCalendarEvents(new Request('https://x/api/mkr/calendar/events'), env);
    const body = (await res.json()) as { data: { items: { previous: number | null; consensus: number | null; actual: number | null }[] } };

    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) {
      expect(item.previous).toBeNull();
      expect(item.consensus).toBeNull();
      expect(item.actual).toBeNull();
    }
  });
});
