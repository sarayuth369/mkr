import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlpacaProvider } from '../src/providers/alpaca/alpaca-provider';
import { _resetQuotaUsageForTests, budgetSnapshot } from '../src/providers/quota-manager';

// Task 6 review correction: proves REST-call accounting is exact against
// the REAL provider implementation - this is the second class the review
// flagged (getBatchQuotes issues one real /snapshot request PER symbol,
// via Promise.all over individual getQuote calls).

function snapshotJson(price = 100) {
  return { latestTrade: { p: price } };
}

function usedCount() {
  return budgetSnapshot('alpaca', { dailyRequestBudget: 1_000_000 }).usedCount;
}

function symbolMap(n: number): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < n; i++) map[`SYM${i}`] = `SYM${i}`;
  return map;
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetQuotaUsageForTests();
});

describe('AlpacaProvider - REST call accounting (Task 6 review correction)', () => {
  it('getQuote makes exactly 1 real request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshotJson()), { status: 200 })));
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getQuote('AAPL', 'AAPL');

    expect(usedCount()).toBe(1);
  });

  it('getBatchQuotes with 1 symbol makes exactly 1 real request', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(snapshotJson()), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getBatchQuotes(symbolMap(1));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(usedCount()).toBe(1);
  });

  it('getBatchQuotes with 5 symbols makes exactly 5 real requests - one per symbol, the exact scenario the review flagged', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(snapshotJson()), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getBatchQuotes(symbolMap(5));

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(usedCount()).toBe(5); // NOT 1 - this is what was wrong before the fix
  });

  it('getBatchQuotes with 20 symbols makes exactly 20 real requests', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(snapshotJson()), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getBatchQuotes(symbolMap(20));

    expect(fetchSpy).toHaveBeenCalledTimes(20);
    expect(usedCount()).toBe(20);
  });

  it('a failed per-symbol request within a batch still counts', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 3) return new Response(null, { status: 500 });
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    // getBatchQuotes uses Promise.all internally - a single rejected symbol
    // rejects the whole batch (unlike Twelve Data's Promise.allSettled
    // chunking), but every attempt made before the rejection still counted.
    await provider.getBatchQuotes(symbolMap(5)).catch(() => {});

    expect(calls).toBeGreaterThan(0);
    expect(usedCount()).toBe(calls); // every real attempt counted, exactly once each
  });

  it('getMarketStatus makes NO real request - Alpaca has no market-status endpoint used here, so it must record zero, not fabricate a count', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getMarketStatus('AAPL', 'AAPL');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(usedCount()).toBe(0);
  });

  it('getCandles and healthCheck each make exactly 1 real request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ bars: [] }), { status: 200 })));
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getCandles('AAPL', 'AAPL', 'm1', 10);
    expect(usedCount()).toBe(1);

    await provider.healthCheck();
    expect(usedCount()).toBe(2);
  });

  it('Twelve Data and Alpaca usage are tracked completely independently - a batch call on one never affects the other\'s count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshotJson()), { status: 200 })));
    const alpaca = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await alpaca.getBatchQuotes(symbolMap(7));

    expect(budgetSnapshot('alpaca', { dailyRequestBudget: 1_000_000 }).usedCount).toBe(7);
    expect(budgetSnapshot('twelve_data', { dailyRequestBudget: 1_000_000 }).usedCount).toBe(0);
  });
});
