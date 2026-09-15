import { describe, expect, it } from 'vitest';
import { handleAdminCalendar } from '../src/admin/admin-calendar-routes';
import { runCalendarIngestion } from '../src/calendar/ingestion';
import type { Env } from '../src/types';
import { createFakeCalendarD1 } from './calendar-fakes';
import { createFakeKv } from './fakes';

function makeEnv(db: D1Database): Env {
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
  };
}

describe('handleAdminCalendar - minimal observability', () => {
  it('reports offline with zero counts before any ingestion has run', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);

    const res = await handleAdminCalendar(new Request('https://x/api/mkr/admin/calendar'), env);
    const body = (await res.json()) as { data: { freshness: string; totalEventCount: number; sources: unknown[] } };

    expect(body.data.freshness).toBe('offline');
    expect(body.data.totalEventCount).toBe(0);
    expect(body.data.sources).toEqual([]);
  });

  it('reports source status, event counts, and upcoming high-importance count after ingestion', async () => {
    const { db } = createFakeCalendarD1();
    const env = makeEnv(db);
    await runCalendarIngestion(env, []);

    const res = await handleAdminCalendar(new Request('https://x/api/mkr/admin/calendar'), env);
    const body = (await res.json()) as {
      data: { freshness: string; totalEventCount: number; upcomingHighImportanceCount: number; sources: { source: string; lastSuccessAt: number | null }[] };
    };

    expect(body.data.freshness).toBe('live');
    expect(body.data.totalEventCount).toBeGreaterThan(0);
    expect(body.data.upcomingHighImportanceCount).toBeGreaterThan(0); // FOMC/CPI/NFP entries are all high-importance
    expect(body.data.sources.find((s) => s.source === 'curated_official')?.lastSuccessAt).not.toBeNull();
  });
});
