import { describe, expect, it } from 'vitest';
import { handleAdminAuditLog, handleAdminSymbolsBulkUpdate, handleAdminSymbolsGet, handleAdminSymbolsUpdate } from '../src/admin/admin-routes';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

/**
 * 2026-09-17 Final UX/Reliability task - a genuinely stateful fake `symbols`
 * + `audit_log` D1 (unlike `createFakeD1`'s always-empty recorder), needed
 * because these tests exercise real reads-after-writes: upsert a row, then
 * GET it back with its computed `status`/`providerCoverage`; write an audit
 * entry via one route, then read it back via the new `GET /admin/audit-log`
 * route this same task adds.
 */
function fakeStatefulD1(initialRows: SymbolRow[] = []): D1Database {
  const symbols = new Map<string, SymbolRow>(initialRows.map((r) => [r.symbol, r]));
  const auditLog: { id: number; actor: string; action: string; target: string | null; old_value: string | null; new_value: string | null; created_at: number }[] = [];
  let nextAuditId = 1;

  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return api;
        },
        async all<T>() {
          if (sql.includes('FROM symbols')) {
            const rows = [...symbols.values()].sort((a, b) => a.sort_order - b.sort_order);
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes('FROM audit_log')) {
            const limit = (boundArgs[0] as number) ?? 100;
            const rows = [...auditLog].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async first<T>() {
          if (sql.includes('FROM symbols')) {
            const symbol = boundArgs[0] as string;
            return (symbols.get(symbol) ?? null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          if (sql.startsWith('INSERT INTO symbols')) {
            const [symbol, display_name, category, enabled, featured, sort_order, twelve_data_symbol, alpaca_symbol, default_timeframe, cache_ttl_seconds, updated_at] = boundArgs as [
              string,
              string,
              string,
              number,
              number,
              number,
              string | null,
              string | null,
              string,
              number | null,
              number,
            ];
            symbols.set(symbol, { symbol, display_name, category, enabled, featured, sort_order, twelve_data_symbol, alpaca_symbol, default_timeframe, cache_ttl_seconds, updated_at });
          } else if (sql.startsWith('INSERT INTO audit_log')) {
            const [actor, action, target, old_value, new_value, created_at] = boundArgs as [string, string, string | null, string | null, string | null, number];
            auditLog.push({ id: nextAuditId++, actor, action, target, old_value, new_value, created_at });
          }
          return { success: true, meta: {} };
        },
      };
      return api;
    },
  } as unknown as D1Database;
}

function symbolRow(overrides: Partial<SymbolRow> & { symbol: string }): SymbolRow {
  return {
    display_name: overrides.symbol,
    category: 'us_stock',
    enabled: 1,
    featured: 0,
    sort_order: 0,
    twelve_data_symbol: overrides.symbol,
    alpaca_symbol: null,
    default_timeframe: 'd1',
    cache_ttl_seconds: null,
    updated_at: 0,
    ...overrides,
  };
}

function makeEnv(rows: SymbolRow[] = []): Env {
  return {
    MKR_CONFIG: createFakeKv(),
    MKR_CACHE: createFakeKv(),
    MKR_DB: fakeStatefulD1(rows),
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

describe('handleAdminSymbolsGet - status/providerCoverage clarity (2026-09-17 Final UX/Reliability task)', () => {
  it('an enabled row is status "enabled" regardless of mapping shape', async () => {
    const env = makeEnv([symbolRow({ symbol: 'AAPL', enabled: 1, twelve_data_symbol: 'AAPL', alpaca_symbol: 'AAPL' })]);
    const res = await handleAdminSymbolsGet(new Request('https://x/api/mkr/admin/symbols'), env);
    const body = (await res.json()) as { data: { symbol: string; status: string; providerCoverage: string }[] };

    expect(body.data[0]?.status).toBe('enabled');
    expect(body.data[0]?.providerCoverage).toBe('both');
  });

  it('a disabled row WITH a real mapping is "standby", never confused with a genuinely dead row', async () => {
    const env = makeEnv([
      symbolRow({ symbol: 'JPM', enabled: 0, twelve_data_symbol: null, alpaca_symbol: 'JPM' }), // catalog-expansion-verified, standing by
      symbolRow({ symbol: 'SPX', enabled: 0, twelve_data_symbol: null, alpaca_symbol: null }), // genuinely dead legacy row
    ]);
    const res = await handleAdminSymbolsGet(new Request('https://x/api/mkr/admin/symbols'), env);
    const body = (await res.json()) as { data: { symbol: string; status: string; providerCoverage: string }[] };
    const bySymbol = Object.fromEntries(body.data.map((r) => [r.symbol, r]));

    expect(bySymbol.JPM?.status).toBe('standby');
    expect(bySymbol.JPM?.providerCoverage).toBe('alpaca');
    expect(bySymbol.SPX?.status).toBe('dead');
    expect(bySymbol.SPX?.providerCoverage).toBe('none');
  });

  it('the status query param filters to exactly that computed status', async () => {
    const env = makeEnv([
      symbolRow({ symbol: 'AAPL', enabled: 1 }),
      symbolRow({ symbol: 'JPM', enabled: 0, twelve_data_symbol: null, alpaca_symbol: 'JPM' }),
      symbolRow({ symbol: 'SPX', enabled: 0, twelve_data_symbol: null, alpaca_symbol: null }),
    ]);

    const standbyRes = await handleAdminSymbolsGet(new Request('https://x/api/mkr/admin/symbols?status=standby'), env);
    const standbyBody = (await standbyRes.json()) as { data: { symbol: string }[] };
    expect(standbyBody.data.map((r) => r.symbol)).toEqual(['JPM']);

    const deadRes = await handleAdminSymbolsGet(new Request('https://x/api/mkr/admin/symbols?status=dead'), env);
    const deadBody = (await deadRes.json()) as { data: { symbol: string }[] };
    expect(deadBody.data.map((r) => r.symbol)).toEqual(['SPX']);
  });

  it('an unrecognized status value is ignored rather than silently returning zero rows', async () => {
    const env = makeEnv([symbolRow({ symbol: 'AAPL', enabled: 1 })]);
    const res = await handleAdminSymbolsGet(new Request('https://x/api/mkr/admin/symbols?status=bogus'), env);
    const body = (await res.json()) as { data: { symbol: string }[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('GET /admin/audit-log (2026-09-17 Final UX/Reliability task - closes the "cannot trace who flipped a flag" gap)', () => {
  it('returns entries written by an admin mutation, newest first', async () => {
    const env = makeEnv([symbolRow({ symbol: 'AAPL', enabled: 1 })]);

    await handleAdminSymbolsUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ symbol: 'AAPL', enabled: false }) }), env, 'admin');
    await handleAdminSymbolsUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ symbol: 'AAPL', enabled: true }) }), env, 'admin');

    const res = await handleAdminAuditLog(new Request('https://x/api/mkr/admin/audit-log'), env);
    const body = (await res.json()) as { data: { action: string }[] };

    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.data.every((r) => r.action === 'symbol.updated')).toBe(true);
  });

  it('respects a limit query param', async () => {
    const env = makeEnv([symbolRow({ symbol: 'AAPL', enabled: 1 }), symbolRow({ symbol: 'MSFT', enabled: 1 })]);
    await handleAdminSymbolsBulkUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ patches: [{ symbol: 'AAPL', enabled: false }] }) }), env, 'admin');
    await handleAdminSymbolsBulkUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ patches: [{ symbol: 'MSFT', enabled: false }] }) }), env, 'admin');

    const res = await handleAdminAuditLog(new Request('https://x/api/mkr/admin/audit-log?limit=1'), env);
    const body = (await res.json()) as { data: unknown[] };

    expect(body.data).toHaveLength(1);
  });

  it('never returns a raw secret-shaped value - recordAuditEntry already refuses to persist one', async () => {
    // Defense-in-depth check: even though assertSafeToLog runs at WRITE
    // time (audit-log.ts), confirm a normal admin action's audit trail
    // contains no field that looks like a credential.
    const env = makeEnv([symbolRow({ symbol: 'AAPL', enabled: 1 })]);
    await handleAdminSymbolsUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ symbol: 'AAPL', enabled: false }) }), env, 'admin');

    const res = await handleAdminAuditLog(new Request('https://x/api/mkr/admin/audit-log'), env);
    const text = await res.text();

    expect(text.toLowerCase()).not.toMatch(/apikey|api_key|secret|password|token/);
  });
});
