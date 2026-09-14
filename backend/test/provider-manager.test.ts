import { beforeEach, describe, expect, it } from 'vitest';
import { _resetCircuitsForTests } from '../src/providers/circuit-breaker';
import { MarketProviderManager, _resetHealthForTests, type ProviderBudgets } from '../src/providers/provider-manager';
import { _resetQuotaUsageForTests, recordProviderRequest } from '../src/providers/quota-manager';
import { ProviderError, type MarketDataProvider } from '../src/providers/types';
import type { NormalizedQuote, ProviderId } from '../src/types';

// Unconfigured (dailyRequestBudget: 0) for both providers - reproduces the
// exact pre-Task-6 behavior (guard always allows) for every test in this
// file that isn't specifically exercising the quota guard itself (see the
// "Task 6" describe block below, and quota-manager.test.ts for the pure
// policy logic, and twelve-data-provider-quota.test.ts /
// alpaca-provider-quota.test.ts for real multi-chunk/multi-symbol
// REST-call-counting accuracy against the actual provider implementations).
const UNCONFIGURED_BUDGETS: ProviderBudgets = { twelveData: { dailyRequestBudget: 0 }, alpaca: { dailyRequestBudget: 0 } };

function quote(price: number): NormalizedQuote {
  return {
    symbol: 'AAPL',
    name: null,
    price,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    previousClose: null,
    volume: null,
    bid: null,
    ask: null,
    currency: 'USD',
    timestamp: Date.now(),
    source: 'twelve_data',
    isLive: true,
    sessionStatus: 'unknown',
  };
}

class FakeProvider implements MarketDataProvider {
  constructor(
    readonly id: ProviderId,
    private opts: { healthy?: boolean; quoteResult?: NormalizedQuote | null; throwKind?: 'timeout' | 'rate_limit' | 'auth' | 'network' } = {},
  ) {}

  quoteCalls = 0;
  batchCalls = 0;

  // Task 6 review correction: real providers record their own usage at
  // their one true low-level request() choke point (see the contract
  // documented on MarketDataProvider in providers/types.ts) - this fake
  // honors that same contract (1 record per simulated "real request") so
  // the quota-guard integration tests below remain meaningful. Exact
  // multi-chunk/multi-symbol counting fidelity is proven separately,
  // directly against the real TwelveDataProvider/AlpacaProvider classes.
  async getQuote(): Promise<NormalizedQuote | null> {
    this.quoteCalls++;
    recordProviderRequest(this.id);
    if (this.opts.throwKind) throw new ProviderError(`${this.id} failed`, this.opts.throwKind);
    return this.opts.quoteResult ?? null;
  }

  async getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>> {
    this.batchCalls++;
    recordProviderRequest(this.id);
    if (this.opts.throwKind) throw new ProviderError(`${this.id} failed`, this.opts.throwKind);
    const result: Record<string, NormalizedQuote | null> = {};
    for (const mkrSymbol of Object.values(providerToMkr)) result[mkrSymbol] = this.opts.quoteResult ?? null;
    return result;
  }

  async getCandles() {
    return [];
  }

  async getMarketStatus() {
    return { symbol: 'AAPL', market: null, exchange: null, session: 'unknown' as const, isOpen: null, timestamp: Date.now(), source: this.id };
  }

  async healthCheck() {
    recordProviderRequest(this.id);
    return { healthy: this.opts.healthy ?? true, latencyMs: 10 };
  }
}

const symbolFor = () => 'AAPL';

beforeEach(() => {
  _resetHealthForTests();
  _resetQuotaUsageForTests();
  _resetCircuitsForTests();
});

describe('MarketProviderManager', () => {
  it('uses the primary when it succeeds', async () => {
    const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
    const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);
    const { result, source } = await manager.getQuote('AAPL', symbolFor);
    expect(result?.price).toBe(100);
    expect(source).toBe('twelve_data');
  });

  it('an empty-but-healthy primary result is NOT treated as failure and is returned as null', async () => {
    const primary = new FakeProvider('twelve_data', { quoteResult: null, healthy: true });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(999) });
    const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);
    const { result, source } = await manager.getQuote('AAPL', symbolFor);
    expect(result).toBeNull();
    expect(source).toBe('twelve_data'); // never silently swapped to secondary
  });

  it('fails over to a healthy secondary only after primary healthCheck confirms unhealthy', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
    const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);
    const { result, source } = await manager.getQuote('AAPL', symbolFor);
    expect(result?.price).toBe(50);
    expect(source).toBe('alpaca');
  });

  it('does not fail over when the primary is still healthy after a transient error - propagates instead', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'timeout', healthy: true });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
    const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);
    await expect(manager.getQuote('AAPL', symbolFor)).rejects.toThrow('twelve_data failed');
    expect(secondary.quoteCalls).toBe(0);
  });

  it('does not fail over to a disabled secondary even if it would be healthy', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'auth', healthy: false });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(1) });
    const manager = new MarketProviderManager(primary, secondary, false, UNCONFIGURED_BUDGETS);
    await expect(manager.getQuote('AAPL', symbolFor)).rejects.toThrow();
    expect(secondary.quoteCalls).toBe(0);
  });

  it('throws when both primary and secondary are unavailable', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'rate_limit', healthy: false });
    const secondary = new FakeProvider('alpaca', { throwKind: 'network' });
    const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);
    await expect(manager.getQuote('AAPL', symbolFor)).rejects.toThrow();
  });

  it('healthSnapshot reports a disabled secondary distinctly from unhealthy', async () => {
    const primary = new FakeProvider('twelve_data', { healthy: true });
    const secondary = new FakeProvider('alpaca', { healthy: true });
    const manager = new MarketProviderManager(primary, secondary, false, UNCONFIGURED_BUDGETS);
    const snapshot = await manager.healthSnapshot();
    expect(snapshot.primary?.status).toBe('healthy');
    expect(snapshot.secondary?.status).toBe('disabled');
  });

  describe('getBatchQuotes', () => {
    const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

    it('resolves every symbol in exactly one call to the provider, not one per symbol', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      const { result, source } = await manager.getBatchQuotes(['AAPL', 'MSFT', 'GOOGL'], providerSymbolFor);

      expect(primary.batchCalls).toBe(1);
      expect(primary.quoteCalls).toBe(0);
      expect(source).toBe('twelve_data');
      expect(Object.keys(result)).toEqual(['AAPL', 'MSFT', 'GOOGL']);
    });

    it('fails over to secondary only after the primary batch call is confirmed unhealthy', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'rate_limit', healthy: false });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(7) });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      const { source } = await manager.getBatchQuotes(['AAPL', 'MSFT'], providerSymbolFor);

      expect(source).toBe('alpaca');
      expect(secondary.batchCalls).toBe(1);
    });

    it('does not fail over on a transient error the primary is still healthy after', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'timeout', healthy: true });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(1) });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      await expect(manager.getBatchQuotes(['AAPL'], providerSymbolFor)).rejects.toThrow();
      expect(secondary.batchCalls).toBe(0);
    });

    it('returns all-null without throwing when no provider maps any requested symbol', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(1) });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      const { result, source } = await manager.getBatchQuotes(['UNMAPPED'], () => null);

      expect(source).toBeNull();
      expect(result).toEqual({ UNMAPPED: null });
      expect(primary.batchCalls).toBe(0);
    });
  });

  describe('Task 6 - quota guard wiring (never bypassable via this manager)', () => {
    it('a budget-denied primary is never even contacted, and falls through to a healthy, separately-budgeted secondary', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(200) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 100 } };
      const manager = new MarketProviderManager(primary, secondary, true, budgets);

      // First call consumes Twelve Data's entire budget (1/1).
      await manager.getQuote('AAPL', symbolFor, 'P1');
      expect(primary.quoteCalls).toBe(1);

      // Second call: Twelve Data is now at 100% for P1 - must not be contacted again; falls to Alpaca instead.
      const { result, source } = await manager.getQuote('AAPL', symbolFor, 'P1');
      expect(primary.quoteCalls).toBe(1); // still 1 - primary was NOT contacted this time
      expect(source).toBe('alpaca');
      expect(result?.price).toBe(200);
    });

    it('a budget denial does NOT mark the provider unhealthy - it was never contacted, so health state is untouched', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // consumes the budget (1/1)
      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow(); // denied, no secondary configured

      // At 100% used, the health probe itself (tagged P4 internally) is ALSO
      // budget-denied - correctly reported as 'unknown' (Decision: never
      // fabricate healthy/unhealthy for a provider that wasn't actually
      // contacted). The claim under test is narrower: errorCount/lastErrorAt
      // must stay untouched by a denial, since recordFailure() is only ever
      // called after a REAL provider error, never after a budget denial.
      const snapshot = await manager.healthSnapshot();
      expect(snapshot.primary?.status).toBe('unknown');
      expect(snapshot.primary?.errorCount).toBe(0);
      expect(snapshot.primary?.lastErrorAt).toBeNull();
    });

    it('the denial error uses the same "rate_limit" kind as a genuine provider 429 - no new error surface, Flutter needs no change', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);

      await manager.getQuote('AAPL', symbolFor, 'P1');
      let caught: unknown;
      await manager.getQuote('AAPL', symbolFor, 'P1').catch((err) => {
        caught = err;
      });
      expect(caught).toBeInstanceOf(ProviderError);
      expect((caught as ProviderError).kind).toBe('rate_limit');
    });

    it('P0 (active user/live + alerts) still reaches the provider even when the budget is fully exhausted for lower priorities', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // exhausts the budget (1/1)
      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow(); // P1 now denied

      const { result } = await manager.getQuote('AAPL', symbolFor, 'P0'); // P0 still goes through
      expect(result?.price).toBe(100);
      expect(primary.quoteCalls).toBe(2); // the P1 denial never touched the provider; only the two P0/first-P1 calls did
    });

    it('getBatchQuotes respects the same guard and provider isolation as getQuote', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(1) });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(2) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 100 } };
      const manager = new MarketProviderManager(primary, secondary, true, budgets);
      const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

      await manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1'); // consumes Twelve Data's budget
      const { source } = await manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1');

      expect(primary.batchCalls).toBe(1); // not called a second time
      expect(source).toBe('alpaca');
    });

    it('healthSnapshot degrades to status "unknown" (never fabricated healthy/unhealthy) when the probe itself is budget-denied', async () => {
      const primary = new FakeProvider('twelve_data', { healthy: true });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // consumes the one available slot as P1
      const snapshot = await manager.healthSnapshot(); // healthCheck is tagged P4 internally - denied once budget is spent

      expect(snapshot.primary?.status).toBe('unknown');
    });

    it('an unconfigured budget (0) never denies anything, at any priority - regression check for the default/no-op case', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      for (let i = 0; i < 50; i++) {
        const { result } = await manager.getQuote('AAPL', symbolFor, 'P4'); // even the lowest priority
        expect(result?.price).toBe(100);
      }
      expect(primary.quoteCalls).toBe(50);
    });
  });

  describe('Final Production Task - circuit breaker integration', () => {
    it('once confirmed unhealthy, a SECOND request skips the primary entirely - no extra call, no extra healthCheck probe', async () => {
      let healthCheckCalls = 0;
      const opts = { throwKind: 'network' as const, healthy: false };
      const primary = new FakeProvider('twelve_data', opts);
      const originalHealthCheck = primary.healthCheck.bind(primary);
      primary.healthCheck = async () => {
        healthCheckCalls++;
        return originalHealthCheck();
      };
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      // First request: primary fails, healthCheck confirms unhealthy, trips the breaker, falls to secondary.
      await manager.getQuote('AAPL', symbolFor, 'P1');
      expect(primary.quoteCalls).toBe(1);
      expect(healthCheckCalls).toBe(1);

      // Second request: breaker is open - primary must not be contacted at all this time.
      await manager.getQuote('AAPL', symbolFor, 'P1');
      expect(primary.quoteCalls).toBe(1); // still 1 - not called again
      expect(healthCheckCalls).toBe(1); // still 1 - no redundant probe either
    });

    it('a single transient failure (healthCheck confirms still healthy) does NOT trip the breaker - the next request still tries the primary normally', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'timeout', healthy: true });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow();
      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow();

      expect(primary.quoteCalls).toBe(2); // both attempts reached the provider - breaker never tripped
    });

    it('after the backoff window elapses, the next request is allowed through as a recovery trial, and success fully closes the breaker', async () => {
      const opts = { throwKind: 'network' as const, healthy: false };
      const primary = new FakeProvider('twelve_data', opts);
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // trips the breaker (falls to secondary)
      expect(primary.quoteCalls).toBe(1);

      // Simulate recovery: the provider starts succeeding again, and enough
      // wall-clock time passes for the backoff window to elapse.
      opts.throwKind = undefined as unknown as 'network';
      (primary as unknown as { opts: { quoteResult: unknown } }).opts.quoteResult = quote(200);
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 31_000; // past the 30s max initial backoff
        const { result, source } = await manager.getQuote('AAPL', symbolFor, 'P1');
        expect(source).toBe('twelve_data'); // the recovery trial succeeded - primary is used again, not secondary
        expect(result?.price).toBe(200);
        expect(primary.quoteCalls).toBe(2); // the trial WAS a real call to primary, unlike the skipped one before it
      } finally {
        Date.now = realNow;
      }
    });

    it('circuit state is isolated per provider - tripping the primary\'s breaker never affects the secondary\'s own circuit', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // trips primary's breaker, secondary succeeds
      const { source } = await manager.getQuote('AAPL', symbolFor, 'P1'); // primary skipped (breaker open), secondary tried fresh each time

      expect(source).toBe('alpaca');
      expect(secondary.quoteCalls).toBe(2); // secondary's own circuit was never affected - it keeps being tried normally
    });

    it('healthSnapshot skips the live probe entirely while the circuit is open - reports unhealthy directly, saving a redundant quota-consuming request', async () => {
      let healthCheckCalls = 0;
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const originalHealthCheck = primary.healthCheck.bind(primary);
      primary.healthCheck = async () => {
        healthCheckCalls++;
        return originalHealthCheck();
      };
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      await manager.getQuote('AAPL', symbolFor, 'P1').catch(() => {}); // trips the breaker (1 healthCheck call, from the confirm-unhealthy step)
      expect(healthCheckCalls).toBe(1);

      const snapshot = await manager.healthSnapshot();
      expect(snapshot.primary?.status).toBe('unhealthy');
      expect(snapshot.primary?.circuit).toBe('open');
      expect(healthCheckCalls).toBe(1); // healthSnapshot did NOT spend a second probe - it already knew the answer
    });
  });
});
