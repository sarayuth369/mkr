import { describe, expect, it, vi } from 'vitest';
import { conditionMet, evaluateTick, isCooledDown } from '../src/alerts/alert-engine';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

describe('conditionMet', () => {
  it('price_above triggers only strictly above the target', () => {
    expect(conditionMet({ condition_type: 'price_above', target_value: 3450 }, 3451)).toBe(true);
    expect(conditionMet({ condition_type: 'price_above', target_value: 3450 }, 3450)).toBe(false);
    expect(conditionMet({ condition_type: 'price_above', target_value: 3450 }, 3410)).toBe(false);
  });

  it('price_below triggers only strictly below the target', () => {
    expect(conditionMet({ condition_type: 'price_below', target_value: 220 }, 219.99)).toBe(true);
    expect(conditionMet({ condition_type: 'price_below', target_value: 220 }, 220)).toBe(false);
    expect(conditionMet({ condition_type: 'price_below', target_value: 220 }, 221)).toBe(false);
  });
});

describe('isCooledDown', () => {
  it('is always cooled down when never triggered before', () => {
    expect(isCooledDown(null, 3600, Date.now())).toBe(true);
  });

  it('refuses to re-trigger before the cooldown window elapses (never spam every tick)', () => {
    const lastTriggered = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const oneMinuteLater = Date.parse(lastTriggered) + 60_000;
    expect(isCooledDown(lastTriggered, 3600, oneMinuteLater)).toBe(false);
  });

  it('allows re-triggering once the cooldown window has fully elapsed', () => {
    const lastTriggered = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const oneHourLater = Date.parse(lastTriggered) + 3600 * 1000;
    expect(isCooledDown(lastTriggered, 3600, oneHourLater)).toBe(true);
  });

  it('treats an unparseable timestamp as never-triggered rather than throwing', () => {
    expect(isCooledDown('not-a-date', 3600, Date.now())).toBe(true);
  });
});

describe('evaluateTick - a triggered alert\'s own async failure never becomes an unhandled rejection (2026-09-15 review)', () => {
  function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
      MKR_CONFIG: createFakeKv(),
      MKR_CACHE: createFakeKv(),
      MKR_DB: {} as never,
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

  async function flushMicrotasks(times = 10): Promise<void> {
    for (let i = 0; i < times; i++) await Promise.resolve();
  }

  it('a getConfig failure inside the fire-and-forget trigger path is caught, not left as an unhandled rejection', async () => {
    // evaluateTick's own outer try/catch only covers ITS synchronous-reachable
    // code up to firing off `triggerAlert` - triggerAlert has its own second,
    // independent `getConfig` call for `pushNotificationsEnabled`, previously
    // unguarded. Call 1 (evaluateTick's own alertsEnabled check) must succeed
    // so a matching row is actually found and triggerAlert gets invoked; call
    // 2 (inside triggerAlert) is made to throw, reproducing a real KV backend
    // error on the second, previously-unprotected read.
    const baseKv = createFakeKv();
    await baseKv.put('runtime-config', JSON.stringify({ featureFlags: { alertsEnabled: true } }));
    let getCalls = 0;
    const configKv = {
      ...baseKv,
      async get(key: string, type?: 'json') {
        getCalls++;
        if (getCalls > 1) throw new Error('simulated KV backend error');
        return type === 'json' ? baseKv.get(key, 'json') : baseKv.get(key);
      },
    } as unknown as Env['MKR_CONFIG'];

    const cacheKv = createFakeKv();
    await cacheKv.put(
      'alerts:index',
      JSON.stringify({
        bySymbol: { 'XAU/USD': [{ id: 'a1', user_id: 'u1', symbol: 'XAU/USD', condition_type: 'price_above', target_value: 100, enabled: true, cooldown_seconds: 60, last_triggered_at: null }] },
        builtAt: Date.now(),
      }),
    );

    const env = makeEnv({ MKR_CONFIG: configKv, MKR_CACHE: cacheKv });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(evaluateTick(env, 'XAU/USD', 150)).resolves.toBeUndefined(); // evaluateTick itself never throws
      await flushMicrotasks(20); // let the fire-and-forget triggerAlert's rejection (if any) actually surface
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]); // the previously-unguarded getConfig failure must be caught, not surfaced as an unhandled rejection
  });
});
