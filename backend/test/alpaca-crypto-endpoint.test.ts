import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlpacaProvider } from '../src/providers/alpaca/alpaca-provider';

// 2026-09-16 Hybrid Capability Validation task - Mac's review finding:
// AlpacaProvider previously used the stock base URL
// (https://data.alpaca.markets/v2/stocks) for EVERY symbol, including
// crypto capability-test symbols BTC/USD and ETH/USD. Alpaca's real crypto
// market data lives under a separate API family
// (https://data.alpaca.markets/v1beta3/crypto/us/...), with a
// multi-symbol-first response shape. These tests confirm the provider now
// dispatches by asset family (derived from the D1 alpaca_symbol mapping
// shape itself - "BTC/USD" contains a slash, "AAPL" doesn't - never a
// second hard-coded catalog), against a stubbed global fetch that asserts
// the exact URL requested - no real network access, no real credentials.

function snapshotJson(price = 100) {
  return { latestTrade: { p: price } };
}

function cryptoSnapshotJson(symbol: string, price = 65000) {
  return { snapshots: { [symbol]: { latestTrade: { p: price } } } };
}

function cryptoBarsJson(symbol: string) {
  return { bars: { [symbol]: [{ t: '2026-01-01T00:00:00Z', o: 1, h: 2, l: 0.5, c: 1.8, v: 5 }] } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlpacaProvider - stock vs crypto endpoint selection', () => {
  it('getQuote routes a stock symbol through /v2/stocks/{symbol}/snapshot', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getQuote('AAPL', 'AAPL');

    // 2026-09-16 Alpaca Credential E2E Test task: `feed=iex` is required -
    // live-confirmed against the real account this task provisioned (see
    // alpaca-provider.ts's own doc comment for the full story).
    expect(requestedUrl).toBe('https://data.alpaca.markets/v2/stocks/AAPL/snapshot?feed=iex');
  });

  it('getQuote routes a crypto symbol through /v1beta3/crypto/us/snapshots?symbols=', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify(cryptoSnapshotJson('BTC/USD')), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const quote = await provider.getQuote('BTC/USD', 'BTC');

    expect(requestedUrl).toBe('https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=BTC%2FUSD');
    expect(quote?.price).toBe(65000);
    expect(quote?.source).toBe('alpaca');
  });

  it('getCandles routes a stock symbol through /v2/stocks/{symbol}/bars', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ bars: [] }), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getCandles('AAPL', 'AAPL', 'd1', 5);

    expect(requestedUrl).toContain('https://data.alpaca.markets/v2/stocks/AAPL/bars');
    // 2026-09-16 Alpaca Credential E2E Test task: an explicit `start` is
    // required - live-confirmed that Alpaca's own default ("beginning of
    // the current day") makes every daily-bars request return empty
    // otherwise (see alpacaBarsStart's own doc comment for the full story).
    expect(requestedUrl).toContain('start=');
    expect(requestedUrl).toContain('feed=iex');
  });

  it('getCandles routes a crypto symbol through /v1beta3/crypto/us/bars?symbols=', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify(cryptoBarsJson('ETH/USD')), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const candles = await provider.getCandles('ETH/USD', 'ETH', 'd1', 5);

    expect(requestedUrl).toContain('https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=ETH%2FUSD');
    expect(candles).toHaveLength(1);
  });

  it('healthCheck always probes the stock family (AAPL), regardless of any crypto activity elsewhere', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.healthCheck();

    expect(requestedUrl).toBe('https://data.alpaca.markets/v2/stocks/AAPL/snapshot?feed=iex');
  });
});

describe('AlpacaProvider.getBatchQuotes - mixed stock + crypto batch', () => {
  it('sends ONE crypto request covering all crypto symbols, plus one sequential stock request per stock symbol', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('/v1beta3/crypto/us/snapshots')) {
          return new Response(JSON.stringify({ snapshots: { 'BTC/USD': { latestTrade: { p: 65000 } }, 'ETH/USD': { latestTrade: { p: 3200 } } } }), { status: 200 });
        }
        return new Response(JSON.stringify(snapshotJson(150)), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ 'AAPL': 'AAPL', 'BTC/USD': 'BTC', 'ETH/USD': 'ETH' });

    // Exactly 2 real HTTP requests total: 1 crypto batch (covering both
    // BTC and ETH) + 1 stock (AAPL) - not 3 separate per-symbol requests.
    expect(urls).toHaveLength(2);
    const cryptoUrls = urls.filter((u) => u.includes('/v1beta3/crypto/us/snapshots'));
    expect(cryptoUrls).toHaveLength(1);
    expect(cryptoUrls[0]).toContain('symbols=BTC%2FUSD,ETH%2FUSD');

    expect(result.AAPL?.price).toBe(150);
    expect(result.BTC?.price).toBe(65000);
    expect(result.ETH?.price).toBe(3200);
  });

  it('a total crypto-group failure does not affect the stock group\'s results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/v1beta3/crypto/us/snapshots')) throw new TypeError('crypto endpoint down');
        return new Response(JSON.stringify(snapshotJson(150)), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ 'AAPL': 'AAPL', 'BTC/USD': 'BTC' });

    expect(result.AAPL?.price).toBe(150);
    expect(result.BTC).toBeUndefined(); // crypto group failed entirely, not fabricated
  });

  it('a total stock-group failure does not affect the crypto group\'s results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/v1beta3/crypto/us/snapshots')) return new Response(JSON.stringify(cryptoSnapshotJson('BTC/USD')), { status: 200 });
        return new Response(null, { status: 429 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ 'AAPL': 'AAPL', 'BTC/USD': 'BTC' });

    expect(result.BTC?.price).toBe(65000);
    expect(result.AAPL).toBeUndefined();
  });

  it('a symbol genuinely missing from the crypto snapshot map resolves to null without affecting its sibling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/v1beta3/crypto/us/snapshots')) return new Response(JSON.stringify({ snapshots: { 'ETH/USD': { latestTrade: { p: 3200 } } } }), { status: 200 });
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ 'BTC/USD': 'BTC', 'ETH/USD': 'ETH' });

    expect(result.BTC).toBeNull();
    expect(result.ETH?.price).toBe(3200);
  });

  it('a crypto-only batch never issues a stock-family request', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(cryptoSnapshotJson('BTC/USD')), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getBatchQuotes({ 'BTC/USD': 'BTC' });

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/v1beta3/crypto/us/snapshots');
  });

  it('a stock-only batch never issues a crypto-family request (byte-identical to pre-task behavior)', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getBatchQuotes({ AAPL: 'AAPL', MSFT: 'MSFT' });

    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes('/v2/stocks/'))).toBe(true);
  });
});
