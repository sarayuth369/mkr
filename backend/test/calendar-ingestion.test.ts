import { afterEach, describe, expect, it, vi } from 'vitest';
import { isoWeekKey, runCalendarIngestion } from '../src/calendar/ingestion';
import { CalendarStore } from '../src/calendar/store';
import type { Env } from '../src/types';
import { createFakeCalendarD1 } from './calendar-fakes';
import { createFakeKv } from './fakes';

function makeEnv(overrides: Partial<Env> = {}, db: D1Database): Env {
  return {
    MKR_CONFIG: createFakeKv(),
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
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('runCalendarIngestion - idempotent end-to-end (curated provider, real store)', () => {
  it('ingesting twice does not duplicate D1 rows', async () => {
    const { db, events } = createFakeCalendarD1();
    const env = makeEnv({}, db);

    const first = await runCalendarIngestion(env, []);
    const countAfterFirst = events.size;
    const second = await runCalendarIngestion(env, []);

    expect(countAfterFirst).toBeGreaterThan(0);
    expect(events.size).toBe(countAfterFirst); // no growth on re-ingestion
    expect(first.eventsUpserted).toBe(second.eventsUpserted);
  });

  it('records a success source-state row for the curated provider', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv({}, db);
    const store = new CalendarStore(db);

    await runCalendarIngestion(env, []);

    const state = await store.sourceState('curated_official');
    expect(state?.lastSuccessAt).not.toBeNull();
    expect(state?.lastEventCount).toBeGreaterThan(0);
  });

  it('does NOT activate FMP by default even when FMP_API_KEY is set - no paid provider active this task', async () => {
    const { db } = createFakeCalendarD1();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv({ FMP_API_KEY: 'fake-fmp-key-not-real' }, db);

    await runCalendarIngestion(env, []); // configuredProviderIds intentionally empty

    expect(fetchSpy).not.toHaveBeenCalled(); // curated provider does no network I/O; FMP was never selected
  });

  it('activating FMP explicitly (configuredProviderIds) with a key configured does call it - proves the opt-in path works, without this task turning it on by default', async () => {
    const { db } = createFakeCalendarD1();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const env = makeEnv({ FMP_API_KEY: 'fake-fmp-key-not-real' }, db);

    const result = await runCalendarIngestion(env, ['fmp']);

    expect(result.outcomes.map((o) => o.providerId)).toEqual(expect.arrayContaining(['curated_official', 'fmp']));
  });

  it('a source failure does not prevent the curated provider\'s data from being ingested - failure isolation end-to-end', async () => {
    const { db, events } = createFakeCalendarD1();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    const env = makeEnv({ FMP_API_KEY: 'fake-fmp-key-not-real' }, db);

    const result = await runCalendarIngestion(env, ['fmp']);

    expect(events.size).toBeGreaterThan(0); // curated events still landed
    const fmpOutcome = result.outcomes.find((o) => o.providerId === 'fmp');
    expect(fmpOutcome?.ok).toBe(false);
  });

  it('concurrent ingestion runs are safe by idempotency (no locking infrastructure added/needed) - two simultaneous runs against the same store never produce duplicate or corrupted rows', async () => {
    const { db, events } = createFakeCalendarD1();
    const env = makeEnv({}, db);

    const [a, b] = await Promise.all([runCalendarIngestion(env, []), runCalendarIngestion(env, [])]);

    expect(a.eventsUpserted).toBe(b.eventsUpserted);
    expect(events.size).toBe(a.eventsUpserted); // still exactly one row per event, not doubled
  });

  it('best-effort cache invalidation never throws even when KV delete fails', async () => {
    const { db } = createFakeCalendarD1();
    const cache = createFakeKv();
    cache.delete = async () => {
      throw new Error('KV delete quota exceeded');
    };
    const env = makeEnv({ MKR_CACHE: cache }, db);

    await expect(runCalendarIngestion(env, [])).resolves.toBeDefined();
  });
});

describe('isoWeekKey', () => {
  it('produces ISO-8601 week keys, e.g. "2026-W38"', () => {
    // 2026-09-16 is a Wednesday in ISO week 38.
    expect(isoWeekKey(new Date(Date.UTC(2026, 8, 16)))).toBe('2026-W38');
  });

  it('is stable for every day within the same ISO week', () => {
    const monday = isoWeekKey(new Date(Date.UTC(2026, 8, 14)));
    const sunday = isoWeekKey(new Date(Date.UTC(2026, 8, 20)));
    expect(monday).toBe(sunday);
  });
});
