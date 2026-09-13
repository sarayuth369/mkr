import { beforeEach, describe, expect, it } from 'vitest';
import { MarketProviderManager, _resetHealthForTests } from '../src/providers/provider-manager';
import { ProviderError, type MarketDataProvider } from '../src/providers/types';
import type { NormalizedQuote, ProviderId } from '../src/types';

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

  async getQuote(): Promise<NormalizedQuote | null> {
    this.quoteCalls++;
    if (this.opts.throwKind) throw new ProviderError(`${this.id} failed`, this.opts.throwKind);
    return this.opts.quoteResult ?? null;
  }

  async getBatchQuotes(providerToMkr: Record<string, string>): Promise<Record<string, NormalizedQuote | null>> {
    this.batchCalls++;
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
    return { healthy: this.opts.healthy ?? true, latencyMs: 10 };
  }
}

const symbolFor = () => 'AAPL';

beforeEach(() => _resetHealthForTests());

describe('MarketProviderManager', () => {
  it('uses the primary when it succeeds', async () => {
    const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
    const manager = new MarketProviderManager(primary, null, false);
    const { result, source } = await manager.getQuote('AAPL', symbolFor);
    expect(result?.price).toBe(100);
    expect(source).toBe('twelve_data');
  });

  it('an empty-but-healthy primary result is NOT treated as failure and is returned as null', async () => {
    const primary = new FakeProvider('twelve_data', { quoteResult: null, healthy: true });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(999) });
    const manager = new MarketProviderManager(primary, secondary, true);
    const { result, source } = await manager.getQuote('AAPL', symbolFor);
    expect(result).toBeNull();
    expect(source).toBe('twelve_data'); // never silently swapped to secondary
  });

  it('fails over to a healthy secondary only after primary healthCheck confirms unhealthy', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'network', healthy: false });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
    const manager = new MarketProviderManager(primary, secondary, true);
    const { result, source } = await manager.getQuote('AAPL', symbolFor);
    expect(result?.price).toBe(50);
    expect(source).toBe('alpaca');
  });

  it('does not fail over when the primary is still healthy after a transient error - propagates instead', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'timeout', healthy: true });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(50) });
    const manager = new MarketProviderManager(primary, secondary, true);
    await expect(manager.getQuote('AAPL', symbolFor)).rejects.toThrow('twelve_data failed');
    expect(secondary.quoteCalls).toBe(0);
  });

  it('does not fail over to a disabled secondary even if it would be healthy', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'auth', healthy: false });
    const secondary = new FakeProvider('alpaca', { quoteResult: quote(1) });
    const manager = new MarketProviderManager(primary, secondary, false);
    await expect(manager.getQuote('AAPL', symbolFor)).rejects.toThrow();
    expect(secondary.quoteCalls).toBe(0);
  });

  it('throws when both primary and secondary are unavailable', async () => {
    const primary = new FakeProvider('twelve_data', { throwKind: 'rate_limit', healthy: false });
    const secondary = new FakeProvider('alpaca', { throwKind: 'network' });
    const manager = new MarketProviderManager(primary, secondary, true);
    await expect(manager.getQuote('AAPL', symbolFor)).rejects.toThrow();
  });

  it('healthSnapshot reports a disabled secondary distinctly from unhealthy', async () => {
    const primary = new FakeProvider('twelve_data', { healthy: true });
    const secondary = new FakeProvider('alpaca', { healthy: true });
    const manager = new MarketProviderManager(primary, secondary, false);
    const snapshot = await manager.healthSnapshot();
    expect(snapshot.primary?.status).toBe('healthy');
    expect(snapshot.secondary?.status).toBe('disabled');
  });

  describe('getBatchQuotes', () => {
    const providerSymbolFor = (_id: string, mkrSymbol: string) => mkrSymbol;

    it('resolves every symbol in exactly one call to the provider, not one per symbol', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(100) });
      const manager = new MarketProviderManager(primary, null, false);

      const { result, source } = await manager.getBatchQuotes(['AAPL', 'MSFT', 'GOOGL'], providerSymbolFor);

      expect(primary.batchCalls).toBe(1);
      expect(primary.quoteCalls).toBe(0);
      expect(source).toBe('twelve_data');
      expect(Object.keys(result)).toEqual(['AAPL', 'MSFT', 'GOOGL']);
    });

    it('fails over to secondary only after the primary batch call is confirmed unhealthy', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'rate_limit', healthy: false });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(7) });
      const manager = new MarketProviderManager(primary, secondary, true);

      const { source } = await manager.getBatchQuotes(['AAPL', 'MSFT'], providerSymbolFor);

      expect(source).toBe('alpaca');
      expect(secondary.batchCalls).toBe(1);
    });

    it('does not fail over on a transient error the primary is still healthy after', async () => {
      const primary = new FakeProvider('twelve_data', { throwKind: 'timeout', healthy: true });
      const secondary = new FakeProvider('alpaca', { quoteResult: quote(1) });
      const manager = new MarketProviderManager(primary, secondary, true);

      await expect(manager.getBatchQuotes(['AAPL'], providerSymbolFor)).rejects.toThrow();
      expect(secondary.batchCalls).toBe(0);
    });

    it('returns all-null without throwing when no provider maps any requested symbol', async () => {
      const primary = new FakeProvider('twelve_data', { quoteResult: quote(1) });
      const manager = new MarketProviderManager(primary, null, false);

      const { result, source } = await manager.getBatchQuotes(['UNMAPPED'], () => null);

      expect(source).toBeNull();
      expect(result).toEqual({ UNMAPPED: null });
      expect(primary.batchCalls).toBe(0);
    });
  });
});
