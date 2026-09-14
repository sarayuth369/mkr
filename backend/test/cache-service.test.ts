import { describe, expect, it } from 'vitest';
import { _resetInFlightForTests, cachedFetch, coalesced, putCached } from '../src/cache/cache-service';
import { createFakeKv } from './fakes';

describe('cachedFetch', () => {
  it('a second call within the TTL reuses the cached value without calling fetcher again', async () => {
    const kv = createFakeKv();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { price: 1 };
    };
    await cachedFetch(kv, 'k', 60, fetcher);
    await cachedFetch(kv, 'k', 60, fetcher);
    expect(calls).toBe(1);
  });

  it('concurrent calls for the same key de-duplicate into a single fetch', async () => {
    _resetInFlightForTests();
    const kv = createFakeKv();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { price: 2 };
    };
    const results = await Promise.all([cachedFetch(kv, 'k2', 60, fetcher), cachedFetch(kv, 'k2', 60, fetcher), cachedFetch(kv, 'k2', 60, fetcher)]);
    expect(calls).toBe(1);
    expect(results.every((r) => r.value.price === 2)).toBe(true);
  });

  it('caches a healthy-but-empty (null) result too, avoiding repeated upstream calls', async () => {
    const kv = createFakeKv();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return null;
    };
    await cachedFetch(kv, 'k3', 60, fetcher);
    const second = await cachedFetch(kv, 'k3', 60, fetcher);
    expect(calls).toBe(1);
    expect(second.value).toBeNull();
    expect(second.cached).toBe(true);
  });

  it('different keys are not deduplicated against each other', async () => {
    const kv = createFakeKv();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls;
    };
    await cachedFetch(kv, 'a', 60, fetcher);
    await cachedFetch(kv, 'b', 60, fetcher);
    expect(calls).toBe(2);
  });

  // Phase 0.C - a KV write is non-essential once the value is already in
  // hand: a failed cache-population write (e.g. quota exhausted) must not
  // turn an otherwise-successful market-data fetch into an error response.
  it('still returns the freshly fetched value when the KV write fails (e.g. 429 quota exceeded)', async () => {
    const failingKv = {
      get: async () => null,
      put: async () => {
        throw new Error('KV PUT quota exceeded');
      },
    } as unknown as Parameters<typeof cachedFetch>[0];

    const result = await cachedFetch(failingKv, 'k4', 60, async () => ({ price: 42 }));

    expect(result.value).toEqual({ price: 42 });
    expect(result.cached).toBe(false);
  });

  // Phase 5 - fixes the verified handleQuotes gap (bypassed in-flight dedup).
  describe('coalesced', () => {
    it('concurrent calls with the same key share a single fetcher invocation', async () => {
      _resetInFlightForTests();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return { items: ['AAPL', 'XAU/USD'] };
      };
      const results = await Promise.all([coalesced('batch-quotes:AAPL,XAU/USD', fetcher), coalesced('batch-quotes:AAPL,XAU/USD', fetcher)]);
      expect(calls).toBe(1);
      expect(results[0]).toBe(results[1]);
    });

    it('different keys (different uncached-symbol sets) never coalesce with each other', async () => {
      _resetInFlightForTests();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return calls;
      };
      await Promise.all([coalesced('batch-quotes:AAPL', fetcher), coalesced('batch-quotes:XAU/USD', fetcher)]);
      expect(calls).toBe(2);
    });

    it('a later, sequential call after the first resolves runs the fetcher again (not stuck coalescing forever)', async () => {
      _resetInFlightForTests();
      let calls = 0;
      const fetcher = async () => ++calls;
      await coalesced('k', fetcher);
      await coalesced('k', fetcher);
      expect(calls).toBe(2);
    });
  });

  it('putCached does not throw when the underlying KV write fails', async () => {
    const failingKv = {
      get: async () => null,
      put: async () => {
        throw new Error('KV PUT quota exceeded');
      },
    } as unknown as Parameters<typeof putCached>[0];

    await putCached(failingKv, 'k5', { price: 1 }, 60); // throws here if not handled - test fails
  });
});
