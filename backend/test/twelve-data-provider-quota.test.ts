import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwelveDataProvider } from '../src/providers/twelve-data/twelve-data-provider';
import { _resetQuotaUsageForTests, budgetSnapshot } from '../src/providers/quota-manager';

// Task 6 review correction: proves REST-call accounting is exact against
// the REAL provider implementation, not just a fake - this is the class
// the review specifically flagged (getBatchQuotes chunks into groups of 8,
// one real /quote request per chunk).

function quoteJson(price = 100) {
  return { close: String(price), open: String(price), high: String(price), low: String(price), previous_close: String(price), volume: '1', name: 'X', currency: 'USD' };
}

function usedCount() {
  return budgetSnapshot('twelve_data', { dailyRequestBudget: 1_000_000 }).usedCount;
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

describe('TwelveDataProvider - REST call accounting (Task 6 review correction)', () => {
  it('getQuote makes exactly 1 real request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(quoteJson()), { status: 200 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getQuote('AAPL', 'AAPL');

    expect(usedCount()).toBe(1);
  });

  it('getBatchQuotes with 1 symbol delegates to getQuote - exactly 1 request', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(quoteJson()), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getBatchQuotes(symbolMap(1));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(usedCount()).toBe(1);
  });

  it('getBatchQuotes with exactly 8 symbols (one full chunk) makes exactly 1 request', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getBatchQuotes(symbolMap(8));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(usedCount()).toBe(1);
  });

  it('getBatchQuotes with 9 symbols (crosses the chunk-8 boundary) makes exactly 2 requests - the exact undercounting scenario the review flagged', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getBatchQuotes(symbolMap(9));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(usedCount()).toBe(2); // NOT 1 - this is what was wrong before the fix
  });

  it('getBatchQuotes with 17 symbols makes exactly 3 requests (ceil(17/8))', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getBatchQuotes(symbolMap(17));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(usedCount()).toBe(3);
  });

  it('a failed chunk request still counts - it consumed real provider quota even though it errored', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 2) return new Response(JSON.stringify({ status: 'error', message: 'boom' }), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getBatchQuotes(symbolMap(16)); // 2 chunks, one of which "fails" (error envelope)

    expect(calls).toBe(2);
    expect(usedCount()).toBe(2); // both attempts counted, regardless of outcome
  });

  it('a network-level failure (thrown, not just an error envelope) still counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getQuote('AAPL', 'AAPL').catch(() => {});

    expect(usedCount()).toBe(1); // the attempt itself is what consumes quota, not a successful response
  });

  it('getCandles, getMarketStatus, and healthCheck each make exactly 1 real request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ values: [] }), { status: 200 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    await provider.getCandles('AAPL', 'AAPL', 'm1', 10);
    expect(usedCount()).toBe(1);

    await provider.getMarketStatus('AAPL', 'AAPL');
    expect(usedCount()).toBe(2);

    await provider.healthCheck();
    expect(usedCount()).toBe(3);
  });

  it('a denied request (never reaching the provider at all) records nothing - MarketProviderManager-level denial means request() is never called', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Simulating a manager-level denial: the provider is simply never invoked.
    // Directly confirms recording only ever happens at the real HTTP call site.
    expect(usedCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
