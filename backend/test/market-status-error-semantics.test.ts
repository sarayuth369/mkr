import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlpacaProvider } from '../src/providers/alpaca/alpaca-provider';
import { _resetCircuitsForTests } from '../src/providers/circuit-breaker';
import { _resetHealthForTests, MarketProviderManager, type ProviderBudgets } from '../src/providers/provider-manager';
import { _resetQuotaUsageForTests } from '../src/providers/quota-manager';
import { TwelveDataProvider } from '../src/providers/twelve-data/twelve-data-provider';

// Final Edit Task - Finding 3: getMarketStatus() must not convert a genuine
// provider failure into a successful "unavailable" result - that would hide
// the failure from MarketProviderManager.withFailover (which only reacts to
// a REJECTED promise), so failover/circuit-breaker logic could never react
// to a market-status-only outage. A legitimate "status unavailable/not
// supported" result (Alpaca has no status endpoint at all; Twelve Data
// returns a sparse-but-valid response) must remain non-fatal.

const UNCONFIGURED_BUDGETS: ProviderBudgets = { twelveData: { dailyRequestBudget: 0 }, alpaca: { dailyRequestBudget: 0 } };
const symbolFor = () => 'AAPL';

afterEach(() => {
  vi.unstubAllGlobals();
  _resetHealthForTests();
  _resetQuotaUsageForTests();
  _resetCircuitsForTests();
});

describe('TwelveDataProvider.getMarketStatus - error semantics (Finding 3)', () => {
  it('a normal, supported response resolves successfully with real status fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'NASDAQ', exchange: 'NASDAQ', is_market_open: true }), { status: 200 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    const status = await provider.getMarketStatus('AAPL', 'AAPL');

    expect(status.isOpen).toBe(true);
    expect(status.session).toBe('open');
    expect(status.exchange).toBe('NASDAQ');
  });

  it('a genuine network failure THROWS - it must reach the manager for failover, never silently become a successful "unavailable" result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const provider = new TwelveDataProvider('fake-key-not-real');

    await expect(provider.getMarketStatus('AAPL', 'AAPL')).rejects.toThrow(/network/i);
  });

  it('an auth failure (401) THROWS, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    await expect(provider.getMarketStatus('AAPL', 'AAPL')).rejects.toThrow(/auth/i);
  });

  it('a rate-limit response (429) THROWS, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    await expect(provider.getMarketStatus('AAPL', 'AAPL')).rejects.toThrow(/rate limit/i);
  });

  it('an embedded API error in an otherwise-200 response THROWS, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', message: 'invalid symbol' }), { status: 200 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    await expect(provider.getMarketStatus('AAPL', 'AAPL')).rejects.toThrow(/invalid symbol/i);
  });

  it('a legitimately sparse-but-valid response (no is_market_open field) stays non-fatal - resolves with isOpen: null, session: "unknown"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'Some Exchange' }), { status: 200 })));
    const provider = new TwelveDataProvider('fake-key-not-real');

    const status = await provider.getMarketStatus('AAPL', 'AAPL');

    expect(status.isOpen).toBeNull();
    expect(status.session).toBe('unknown');
    expect(status.market).toBe('Some Exchange'); // still carries whatever real data the response DID have
  });
});

describe('AlpacaProvider.getMarketStatus - documented "unsupported" case remains non-fatal (Finding 3)', () => {
  it('never makes an HTTP call and never throws - it is a documented, permanent "not supported" case, not a masked failure', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new AlpacaProvider('key', 'secret');

    const status = await provider.getMarketStatus('AAPL', 'AAPL');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status.isOpen).toBeNull();
    expect(status.session).toBe('unknown');
    expect(status.source).toBe('alpaca');
  });
});

describe('MarketProviderManager.getMarketStatus - a genuine provider failure now reaches failover (Finding 3 integration)', () => {
  it('a genuine Twelve Data outage during getMarketStatus fails over to a healthy secondary, exactly like getQuote/getCandles already do', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // Twelve Data's real market-status call uses /quote (see getMarketStatus above);
        // Twelve Data's healthCheck uses /api_usage. Both must fail to simulate a genuine outage.
        if (url.includes('api.twelvedata.com')) throw new Error('network down');
        throw new Error('unexpected call to ' + url);
      }),
    );
    const primary = new TwelveDataProvider('fake-key-not-real');
    const secondary = new AlpacaProvider('key', 'secret');
    const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

    const { result, source } = await manager.getMarketStatus('AAPL', symbolFor, 'P1');

    // BEFORE Finding 3's fix, TwelveDataProvider.getMarketStatus swallowed
    // this exact failure and resolved successfully with an "unavailable"
    // shape - withFailover never saw a rejection, so it never even
    // attempted the secondary. This proves it now does.
    expect(source).toBe('alpaca');
    expect(result.source).toBe('alpaca');
  });

  it('a legitimately sparse Twelve Data response is NOT treated as a failure - stays on the primary, no failover triggered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const primary = new TwelveDataProvider('fake-key-not-real');
    const secondary = new AlpacaProvider('key', 'secret');
    const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

    const { result, source } = await manager.getMarketStatus('AAPL', symbolFor, 'P1');

    expect(source).toBe('twelve_data'); // stayed on the primary - a sparse-but-valid response is not a fault
    expect(result.isOpen).toBeNull();
  });
});
