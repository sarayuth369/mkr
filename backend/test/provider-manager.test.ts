import { beforeEach, describe, expect, it } from 'vitest';
import { _resetCircuitsForTests, admitCircuitRequest, circuitSnapshot, circuitStatus, recordCircuitFailure, recordCircuitSuccess } from '../src/providers/circuit-breaker';
import { MarketProviderManager, _resetHealthForTests, type ProviderBudgets } from '../src/providers/provider-manager';
import { _resetQuotaUsageForTests, budgetSnapshot, recordProviderRequest } from '../src/providers/quota-manager';
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

function usedCount(id: ProviderId, dailyRequestBudget = 1_000_000): number {
  return budgetSnapshot(id, { dailyRequestBudget }).usedCount;
}

/** Wraps a FakeProvider's healthCheck to count real invocations, exactly the pattern the existing circuit-breaker tests above already use. */
function countHealthChecks(provider: FakeProvider): { calls: () => number } {
  let calls = 0;
  const original = provider.healthCheck.bind(provider);
  provider.healthCheck = async () => {
    calls++;
    return original();
  };
  return { calls: () => calls };
}

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

  describe('Final Edit Task - Finding 1: half-open recovery trial is claimed exactly once', () => {
    it('two concurrent getQuote calls during the half-open window: only ONE reaches the primary, the other falls straight to secondary', async () => {
      const opts = { throwKind: 'network' as const, healthy: false };
      const primary = new FakeProvider('twelve_data', opts);
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // trips the primary's breaker
      expect(primary.quoteCalls).toBe(1);

      // Recovery: the provider starts succeeding again, and the backoff window elapses.
      opts.throwKind = undefined as unknown as 'network';
      (primary as unknown as { opts: { quoteResult: unknown } }).opts.quoteResult = quote(200);
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 31_000; // past the 30s max initial backoff - half-open

        // Two "concurrent" calls issued back-to-back with no await between
        // them - both observe the same half-open window before either one
        // resolves, simulating two simultaneous production requests.
        const [a, b] = await Promise.all([manager.getQuote('AAPL', symbolFor, 'P1'), manager.getQuote('AAPL', symbolFor, 'P1')]);

        // Exactly one of the two calls actually claimed the trial and
        // reached the primary a second time; the other must have been
        // denied the primary (admitCircuitRequest is synchronous/atomic)
        // and gone straight to secondary instead.
        expect(primary.quoteCalls).toBe(2); // 1 from the initial trip + exactly 1 more (the trial), never 3
        const sources = [a.source, b.source].sort();
        expect(sources).toEqual(['alpaca', 'twelve_data']);
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe('Final Edit Task - Finding 2: secondary failover is health-confirmed, same as the primary', () => {
    it('a transient secondary error (healthCheck still healthy) does NOT trip the secondary circuit - the next call still tries it normally', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { throwKind: 'timeout', healthy: true });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      // First call: primary confirmed unhealthy, falls to secondary, secondary
      // fails but its OWN healthCheck reports healthy - transient, propagate.
      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('alpaca failed');
      expect(secondary.quoteCalls).toBe(1);

      // Second call: primary's breaker is still open (skipped), and the
      // secondary's circuit must NOT have tripped from the transient error -
      // it gets contacted again normally, not silently skipped.
      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('alpaca failed');
      expect(secondary.quoteCalls).toBe(2); // contacted again - circuit was never tripped by the transient failure
    });

    it('a confirmed secondary outage (healthCheck unhealthy) DOES trip its circuit - a later call skips it entirely', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { throwKind: 'network', healthy: false });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('alpaca failed');
      expect(secondary.quoteCalls).toBe(1);

      // Both circuits are now open - a further call must not contact either provider.
      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('No healthy provider available');
      expect(secondary.quoteCalls).toBe(1); // still 1 - secondary was skipped this time, not contacted again
    });

    it('getBatchQuotes applies the same confirmed-unhealthy rule to a transient secondary failure', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { throwKind: 'timeout', healthy: true });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);
      const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

      await expect(manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1')).rejects.toThrow('alpaca failed');
      await expect(manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1')).rejects.toThrow('alpaca failed');

      expect(secondary.batchCalls).toBe(2); // contacted both times - a transient error never trips the breaker
    });

    it('getBatchQuotes trips the secondary circuit on a confirmed outage, same as getQuote', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { throwKind: 'network', healthy: false });
      const manager = new MarketProviderManager(primary, secondary, true, UNCONFIGURED_BUDGETS);
      const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

      await expect(manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1')).rejects.toThrow('alpaca failed');
      expect(secondary.batchCalls).toBe(1);

      // Both circuits are now open - getBatchQuotes treats "no provider
      // reachable" as a mapping outcome, not a fault (matches its
      // pre-existing "no provider maps this symbol" behavior) - all-null,
      // not a throw. The behavior under test is that secondary is SKIPPED,
      // not contacted a second time.
      const { result, source } = await manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1');
      expect(source).toBeNull();
      expect(result).toEqual({ AAPL: null });
      expect(secondary.batchCalls).toBe(1); // skipped this time - confirmed-unhealthy trip carried over
    });
  });

  describe('Final Edit Task 2 - healthCheck() confirmation is quota-admitted (P4), never bypasses the budget guard', () => {
    it('a failed primary request followed by a healthCheck confirmation consumes exactly 2 real attempts, both covered by quota policy', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 100 }, alpaca: { dailyRequestBudget: 0 } };
      // No secondary configured - once confirmed unhealthy, withFailover has
      // nothing left to fall through to, so it throws its OWN generic "no
      // healthy provider" error rather than the original one (pre-existing
      // behavior, unrelated to this fix) - the property under test here is
      // the confirmation probe's own admission/recording, not the exact
      // error surfaced.
      const manager = new MarketProviderManager(primary, null, false, budgets);
      const hc = countHealthChecks(primary);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow();

      expect(primary.quoteCalls).toBe(1); // the original attempt
      expect(hc.calls()).toBe(1); // the confirmation probe - actually ran, because P4 admission was allowed
      expect(usedCount('twelve_data', 100)).toBe(2); // BOTH real attempts recorded - the confirmation probe is not a free bypass
      expect(circuitStatus('twelve_data')).toBe('open'); // confirmed unhealthy - correctly tripped
    });

    it('a failed secondary request followed by a healthCheck confirmation has the same property', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { throwKind: 'network', healthy: false });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 100 }, alpaca: { dailyRequestBudget: 100 } };
      const manager = new MarketProviderManager(primary, secondary, true, budgets);
      const hc = countHealthChecks(secondary);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('alpaca failed');

      expect(secondary.quoteCalls).toBe(1);
      expect(hc.calls()).toBe(1);
      expect(usedCount('alpaca', 100)).toBe(2); // both the failed request and its confirmation probe recorded
      expect(circuitStatus('alpaca')).toBe('open');
    });

    it('when P4 health-check admission is denied, healthCheck is NOT contacted, the original error is preserved, and the circuit is NOT tripped from an unverified outage', async () => {
      // Budget of exactly 1: the primary's own getQuote attempt consumes
      // the entire daily budget, leaving nothing for a SECOND real request -
      // so the P4 confirmation probe must be denied (100% used -> 'stopped'
      // tier -> P4 is the first priority shed at 70%, already gone by 100%).
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);
      const hc = countHealthChecks(primary);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('twelve_data failed'); // the ORIGINAL error, not a budget error

      expect(primary.quoteCalls).toBe(1); // only the original attempt - healthCheck's own request() never ran
      expect(hc.calls()).toBe(0); // the confirmation probe was never even attempted
      expect(usedCount('twelve_data', 1)).toBe(1); // still just 1 - no bypassed second request was ever recorded
      expect(circuitStatus('twelve_data')).toBe('closed'); // NEVER trip on an unverified outage - this is the core of the fix
    });

    it('a budget-denied confirmation does not fail over either - the outage was never actually confirmed, so falling to secondary would be just as unverified', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(999) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, secondary, true, budgets);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow('twelve_data failed');

      expect(secondary.quoteCalls).toBe(0); // never even tried - the primary's real error propagates directly instead
    });

    it('half-open claimed trials still do not perform an extra healthCheck, even under a real quota policy', async () => {
      const opts = { throwKind: 'network' as const, healthy: false };
      const primary = new FakeProvider('twelve_data', opts);
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 100 }, alpaca: { dailyRequestBudget: 100 } };
      const manager = new MarketProviderManager(primary, secondary, true, budgets);
      const hc = countHealthChecks(primary);

      await manager.getQuote('AAPL', symbolFor, 'P1'); // primary fails, P4-admitted healthCheck confirms unhealthy, trips the breaker, falls to secondary
      expect(hc.calls()).toBe(1); // exactly the confirmation probe from the initial trip - not yet the trial

      opts.throwKind = undefined as unknown as 'network';
      (primary as unknown as { opts: { quoteResult: unknown } }).opts.quoteResult = quote(200);
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 31_000; // past the max initial backoff - half-open
        const { source } = await manager.getQuote('AAPL', symbolFor, 'P1'); // the claimed trial itself
        expect(source).toBe('twelve_data');
        expect(hc.calls()).toBe(1); // STILL 1 - the trial's own outcome IS the confirmation, never a separate healthCheck
      } finally {
        Date.now = realNow;
      }
    });

    it('getBatchQuotes applies the same quota-admitted confirmation rule: denied P4 means no healthCheck, no trip, original error preserved', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 1 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);
      const hc = countHealthChecks(primary);
      const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

      await expect(manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1')).rejects.toThrow('twelve_data failed');

      expect(primary.batchCalls).toBe(1);
      expect(hc.calls()).toBe(0);
      expect(circuitStatus('twelve_data')).toBe('closed');
    });

    it('getBatchQuotes: with sufficient budget, the confirmation probe runs and both attempts are recorded', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 100 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);
      const hc = countHealthChecks(primary);
      const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

      // No secondary configured - a confirmed-unhealthy primary with
      // nothing to fall through to resolves all-null rather than throwing
      // (getBatchQuotes' own pre-existing, documented "no provider
      // reachable" behavior - see the Finding 2 describe block above). The
      // property under test is the confirmation probe's own
      // admission/recording, not the exact resolved shape.
      const { source } = await manager.getBatchQuotes(['AAPL'], providerSymbolFor, 'P1');

      expect(source).toBeNull();
      expect(hc.calls()).toBe(1);
      expect(usedCount('twelve_data', 100)).toBe(2);
      expect(circuitStatus('twelve_data')).toBe('open');
    });

    it('an unconfigured budget (0) never denies the confirmation probe either - regression check for the default/no-op case', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);
      const hc = countHealthChecks(primary);

      await expect(manager.getQuote('AAPL', symbolFor, 'P1')).rejects.toThrow();

      expect(hc.calls()).toBe(1); // unconfigured budget fails open, same as every other admission check in this codebase
      expect(circuitStatus('twelve_data')).toBe('open');
    });
  });

  describe('Final Edit Task 3 - healthSnapshot() must not report an in-flight half-open trial as confirmed unhealthy', () => {
    const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);

    it('an actually-open circuit (still within backoff) still reports "unhealthy" without probing', async () => {
      const primary = new FakeProvider('twelve_data', { healthy: true });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);
      const hc = countHealthChecks(primary);

      recordCircuitFailure('twelve_data', T0); // trip it, genuinely open, well within backoff
      const realNow = Date.now;
      try {
        Date.now = () => T0 + 5_000; // 5s in - nowhere near nextProbeAt (15-30s out)
        const snapshot = await manager.healthSnapshot();

        expect(snapshot.primary?.status).toBe('unhealthy'); // unchanged - a genuinely open circuit is an already-confirmed verdict
        expect(snapshot.primary?.circuit).toBe('open');
        expect(hc.calls()).toBe(0); // no probe attempted
      } finally {
        Date.now = realNow;
      }
    });

    it('a half-open circuit whose single probe is already claimed by another caller reports "unknown", not "unhealthy"', async () => {
      const primary = new FakeProvider('twelve_data', { healthy: true });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);
      const hc = countHealthChecks(primary);

      recordCircuitFailure('twelve_data', T0);
      const past = T0 + 31_000; // past the 30s max initial backoff - unambiguously half-open
      const realNow = Date.now;
      try {
        Date.now = () => past;

        // Simulate a concurrent caller (e.g. real live traffic) already
        // claiming the single half-open recovery trial before this
        // healthSnapshot() call runs.
        const claimed = admitCircuitRequest('twelve_data', past);
        expect(claimed).toEqual({ allowed: true, isProbe: true });

        const snapshot = await manager.healthSnapshot();

        expect(snapshot.primary?.circuit).toBe('half_open'); // an accurate reflection of reality - a trial genuinely is in flight
        expect(snapshot.primary?.status).toBe('unknown'); // NOT 'unhealthy' - the trial hasn't resolved yet, nothing is confirmed
        expect(hc.calls()).toBe(0); // healthSnapshot made zero extra provider calls - it never probed
      } finally {
        Date.now = realNow;
      }
    });

    it('makes zero extra provider healthCheck/network calls when the probe is already claimed - re-confirmed via the quota usage counter, not just the call-count wrapper', async () => {
      const primary = new FakeProvider('twelve_data', { healthy: true });
      const budgets: ProviderBudgets = { twelveData: { dailyRequestBudget: 100 }, alpaca: { dailyRequestBudget: 0 } };
      const manager = new MarketProviderManager(primary, null, false, budgets);

      recordCircuitFailure('twelve_data', T0);
      const past = T0 + 31_000;
      const realNow = Date.now;
      try {
        Date.now = () => past;
        admitCircuitRequest('twelve_data', past); // another caller claims the trial

        const before = usedCount('twelve_data', 100);
        await manager.healthSnapshot();
        const after = usedCount('twelve_data', 100);

        expect(after).toBe(before); // zero real requests recorded - healthSnapshot truly never touched the provider
      } finally {
        Date.now = realNow;
      }
    });

    it('the probe owner (a real caller) can still resolve the circuit normally - healthSnapshot\'s denial branch does not interfere with the claim', async () => {
      const primary = new FakeProvider('twelve_data', { healthy: true });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      recordCircuitFailure('twelve_data', T0);
      const past = T0 + 31_000;
      const realNow = Date.now;
      try {
        Date.now = () => past;
        admitCircuitRequest('twelve_data', past); // the "owner" of the trial

        const snapshot = await manager.healthSnapshot(); // a concurrent, unrelated healthSnapshot call while the trial is in flight
        expect(snapshot.primary?.status).toBe('unknown');

        // The owner's trial now resolves successfully - the circuit must
        // fully close, exactly as if healthSnapshot had never been called
        // in between.
        recordCircuitSuccess('twelve_data');
        expect(circuitStatus('twelve_data', past)).toBe('closed');
      } finally {
        Date.now = realNow;
      }
    });

    it('the probe owner failing still reopens the circuit with the next backoff, unaffected by a concurrent healthSnapshot call', async () => {
      const primary = new FakeProvider('twelve_data', { healthy: true });
      const manager = new MarketProviderManager(primary, null, false, UNCONFIGURED_BUDGETS);

      recordCircuitFailure('twelve_data', T0);
      const firstNextProbeAt = circuitSnapshot('twelve_data', T0).nextProbeAt!;
      const realNow = Date.now;
      try {
        Date.now = () => firstNextProbeAt;
        admitCircuitRequest('twelve_data', firstNextProbeAt); // the owner claims the trial

        await manager.healthSnapshot(); // concurrent, unrelated call - must not disturb the claim

        recordCircuitFailure('twelve_data', firstNextProbeAt); // the trial itself failed
        const snap = circuitSnapshot('twelve_data', firstNextProbeAt);
        expect(snap.status).toBe('open'); // reopened
        expect(snap.nextProbeAt!).toBeGreaterThan(firstNextProbeAt); // backoff grew - a normal second trip, not disrupted
      } finally {
        Date.now = realNow;
      }
    });
  });
});
