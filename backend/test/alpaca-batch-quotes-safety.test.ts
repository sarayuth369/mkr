import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AlpacaProvider } from '../src/providers/alpaca/alpaca-provider';
import { _resetCircuitsForTests, admitCircuitRequest, circuitStatus } from '../src/providers/circuit-breaker';
import { MarketProviderManager, _resetHealthForTests, type ProviderBudgets } from '../src/providers/provider-manager';
import { _resetQuotaUsageForTests, budgetSnapshot } from '../src/providers/quota-manager';

// 2026-09-15 production readiness review, finding 1: AlpacaProvider (never
// activated in production - secondaryEnabled stays false throughout this
// file and everywhere else) had the same class of unsafe-batch-quotes
// issue TwelveDataProvider originally had, via a different mechanism:
// `Promise.all` over N concurrent per-symbol getQuote() calls had no
// concurrency limit AND was fail-fast (one symbol's genuine transient
// error discarded every other symbol's already-fetched result). Fixed:
// sequential requests with per-symbol try/catch isolation - see
// alpaca-provider.ts's getBatchQuotes doc comment for the full reasoning.
//
// These tests exercise the real AlpacaProvider/MarketProviderManager
// classes against a stubbed global fetch - no real network access, no
// real Alpaca account/credentials.

const UNCONFIGURED_BUDGETS: ProviderBudgets = { twelveData: { dailyRequestBudget: 0 }, alpaca: { dailyRequestBudget: 0 } };

function snapshotJson(price = 100) {
  return { latestTrade: { p: price } };
}

function alpacaSymbolNotFoundJson() {
  // Real Alpaca shape for an unknown/invalid symbol - a 'code'+'message'
  // object with no 'latestTrade'/'bars' field, matching isAlpacaError's
  // detection in alpaca-parser.ts.
  return { code: 40410000, message: 'symbol not found' };
}

function symbolMap(n: number): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < n; i++) map[`SYM${i}`] = `SYM${i}`;
  return map;
}

function usedCount() {
  return budgetSnapshot('alpaca', { dailyRequestBudget: 1_000_000 }).usedCount;
}

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  _resetHealthForTests();
  _resetQuotaUsageForTests();
  _resetCircuitsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlpacaProvider.getBatchQuotes - concurrency safety (A)', () => {
  it('requests every symbol sequentially - never more than one real request in flight at once', async () => {
    let activeRequests = 0;
    let maxConcurrent = 0;
    const resolvers: Array<() => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        activeRequests++;
        maxConcurrent = Math.max(maxConcurrent, activeRequests);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        activeRequests--;
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const done = provider.getBatchQuotes(symbolMap(5));
    await flushMicrotasks();

    // If requests were fired concurrently (the old Promise.all behavior),
    // all 5 would already be queued here. A sequential implementation has
    // issued exactly the first one and is awaiting it.
    expect(resolvers.length).toBe(1);

    for (let i = 0; i < 5; i++) {
      expect(resolvers.length).toBe(1);
      resolvers.shift()!();
      await flushMicrotasks();
    }

    await done;
    expect(maxConcurrent).toBe(1);
  });
});

describe('AlpacaProvider.getBatchQuotes - per-symbol failure isolation (B)', () => {
  it('a genuine transient failure (network error) on one symbol does not discard the others\' results', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('SYM2')) throw new TypeError('network down');
        return new Response(JSON.stringify(snapshotJson(150)), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes(symbolMap(5));

    expect(calls).toHaveLength(5); // every symbol was still attempted
    expect(result.SYM2).toBeUndefined(); // the failed symbol has no entry - not fabricated, not silently defaulted
    expect(result.SYM0?.price).toBe(150);
    expect(result.SYM1?.price).toBe(150);
    expect(result.SYM3?.price).toBe(150);
    expect(result.SYM4?.price).toBe(150);
  });

  it('every real attempt is still counted exactly once, including the failed one (quota accounting - E)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('SYM2')) throw new TypeError('network down');
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await provider.getBatchQuotes(symbolMap(5));

    expect(usedCount()).toBe(5); // recorded at the request() choke point regardless of outcome
  });
});

describe('AlpacaProvider.getBatchQuotes - permanent symbol-specific failures (C)', () => {
  it('an "unknown symbol" response resolves to null, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(alpacaSymbolNotFoundJson()), { status: 404 })));
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ BOGUS: 'BOGUS' });

    expect(result).toEqual({ BOGUS: null });
  });

  it('a mix of unknown and valid symbols returns null only for the unknown one, real data for the rest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('BOGUS')) return new Response(JSON.stringify(alpacaSymbolNotFoundJson()), { status: 404 });
        return new Response(JSON.stringify(snapshotJson(200)), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ AAPL: 'AAPL', BOGUS: 'BOGUS' });

    expect(result.AAPL?.price).toBe(200);
    expect(result.BOGUS).toBeNull();
  });

  it('via MarketProviderManager: an unknown-symbol batch never trips the circuit or spends a healthCheck', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(alpacaSymbolNotFoundJson()), { status: 404 })));
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');
    // AlpacaProvider is used as the manager's "primary" purely for this
    // test - secondaryEnabled/production wiring is untouched, this only
    // exercises the shared MarketProviderManager logic against the real
    // AlpacaProvider class.
    const manager = new MarketProviderManager(provider, null, false, UNCONFIGURED_BUDGETS);

    const { result } = await manager.getBatchQuotes(['BOGUS'], () => 'BOGUS');

    expect(result).toEqual({ BOGUS: null });
    expect(circuitStatus('alpaca')).toBe('closed');
    expect(admitCircuitRequest('alpaca').allowed).toBe(true);
  });
});

describe('AlpacaProvider.getBatchQuotes - total transient failure still fails over/trips correctly (D)', () => {
  it('throws when every symbol fails with a genuine transient error - never silently returns an empty/partial success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 429 })));
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    await expect(provider.getBatchQuotes(symbolMap(3))).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  it('via MarketProviderManager: a total transient failure still goes through the normal confirmation/circuit-trip path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 429 })));
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');
    const manager = new MarketProviderManager(provider, null, false, UNCONFIGURED_BUDGETS);

    // Primary fails, healthCheck confirmation also fails (same stubbed
    // 429 fetch) - genuinely confirmed unhealthy, so the circuit trips
    // exactly like any other real transient-failure path. With no
    // secondary configured (same as production - secondaryEnabled stays
    // false), the manager now throws (2026-09-16 post-phone Closed
    // Testing correction task: previously degraded to a silent `{AAPL:
    // null}` result indistinguishable from a genuine provider-confirmed
    // "no data" answer - see provider-manager.ts's getBatchQuotes doc
    // comment for the live-confirmed root cause this fixes) - this test's
    // point is still the circuit trip, which is unchanged.
    await expect(manager.getBatchQuotes(['AAPL'], () => 'AAPL')).rejects.toThrow('No healthy provider available');

    expect(circuitStatus('alpaca')).toBe('open');
  });

  it('a batch with a mix of successes and one total-failure symbol group still returns the successes (regression guard against over-throwing)', async () => {
    // Not "every symbol fails" - only ensures the total-failure path (D)
    // and the partial-failure path (B) remain distinct: this one has at
    // least one success, so it must NOT throw.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('BAD')) throw new TypeError('network down');
        return new Response(JSON.stringify(snapshotJson()), { status: 200 });
      }),
    );
    const provider = new AlpacaProvider('fake-key-id', 'fake-secret-not-real');

    const result = await provider.getBatchQuotes({ GOOD: 'GOOD', BAD: 'BAD' });

    expect(result.GOOD).not.toBeNull();
    expect(result.BAD).toBeUndefined();
  });
});
