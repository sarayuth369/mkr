import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAdminProvidersGet, handleAdminProvidersUpdate } from '../src/admin/admin-routes';
import { ApiError } from '../src/errors';
import { _resetQuotaUsageForTests } from '../src/providers/quota-manager';
import type { Env } from '../src/types';
import { createFakeD1, createFakeKv, type RecordedD1Call } from './fakes';

function makeEnv(overrides: Partial<Env> = {}): { env: Env; auditCalls: RecordedD1Call[] } {
  const { db, calls } = createFakeD1();
  const env = {
    MKR_CONFIG: createFakeKv(),
    MKR_DB: db,
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
    ...overrides,
  } as Env;
  return { env, auditCalls: calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetQuotaUsageForTests();
});

describe('Task 6 - admin provider budgets (reuses the existing /admin/providers route, no new endpoint)', () => {
  it('GET includes a budget snapshot per provider, budget:null when unconfigured', async () => {
    vi.stubGlobal('fetch', vi.fn()); // no provider call should be needed for an unconfigured/no-key health probe
    const { env } = makeEnv();

    const response = await handleAdminProvidersGet(new Request('https://x'), env);
    const body = (await response.json()) as { data: { budgets: { twelve_data: { budget: number | null; tier: string }; alpaca: { budget: number | null } } } };

    expect(body.data.budgets.twelve_data.budget).toBeNull();
    expect(body.data.budgets.twelve_data.tier).toBe('normal');
    expect(body.data.budgets.alpaca.budget).toBeNull();
  });

  it('UPDATE persists a valid providerBudgets patch and audit-logs the change', async () => {
    const { env, auditCalls } = makeEnv();

    const response = await handleAdminProvidersUpdate(
      new Request('https://x', { method: 'POST', body: JSON.stringify({ providerBudgets: { twelveData: { dailyRequestBudget: 800 } } }) }),
      env,
      'admin',
    );
    const body = (await response.json()) as { data: { providerBudgets: { twelveData: { dailyRequestBudget: number }; alpaca: { dailyRequestBudget: number } } } };

    expect(body.data.providerBudgets.twelveData.dailyRequestBudget).toBe(800);
    expect(body.data.providerBudgets.alpaca.dailyRequestBudget).toBe(0); // untouched
    expect(auditCalls.some((c) => c.args.includes('provider.budgets.changed'))).toBe(true);
  });

  it('UPDATE rejects a negative budget rather than silently accepting it', async () => {
    const { env } = makeEnv();

    await expect(
      handleAdminProvidersUpdate(
        new Request('https://x', { method: 'POST', body: JSON.stringify({ providerBudgets: { twelveData: { dailyRequestBudget: -1 } } }) }),
        env,
        'admin',
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('UPDATE with no providerBudgets field leaves existing budgets untouched (backward compatible with the pre-Task-6 request shape)', async () => {
    const { env } = makeEnv();
    await handleAdminProvidersUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ providerBudgets: { twelveData: { dailyRequestBudget: 500 } } }) }), env, 'admin');

    const response = await handleAdminProvidersUpdate(new Request('https://x', { method: 'POST', body: JSON.stringify({ secondaryEnabled: false }) }), env, 'admin');
    const body = (await response.json()) as { data: { providerBudgets: { twelveData: { dailyRequestBudget: number } } } };

    expect(body.data.providerBudgets.twelveData.dailyRequestBudget).toBe(500); // survived an unrelated update
  });
});
