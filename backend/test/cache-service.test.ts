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

  // 2026-09-16 Final Full-System One-Pass audit finding: cachedFetch had no
  // stale fallback despite one being a documented invariant - a provider
  // outage on an already-expired KV entry was a hard failure, not degraded/
  // stale service. These pin the bounded fix. Named "bounded stale
  // fallback," not "stale-while-revalidate" (2026-09-16 Final Release Gate
  // terminology correction) - see cachedFetch's own doc comment in
  // cache-service.ts for exactly why: this is a synchronous fallback on a
  // failed fresh-fetch attempt, never a background revalidation.
  describe('bounded stale fallback (not "stale-while-revalidate" - see cachedFetch\'s doc comment)', () => {
    it('serves a logically-expired-but-still-physically-present value when the fresh refetch itself fails, instead of throwing', async () => {
      const kv = createFakeKv();
      // Seed a value whose storedAt is already outside a 60s TTL - still
      // physically "in KV" (the fake store never expires anything), which
      // is exactly the state a real KV entry is in during its grace window.
      await kv.put('k6', JSON.stringify({ v: { price: 111 }, storedAt: Date.now() - 120_000 }));

      const result = await cachedFetch(kv, 'k6', 60, async () => {
        throw new Error('provider down');
      });

      expect(result.value).toEqual({ price: 111 });
    });

    it('a genuinely fresh value is still served without ever calling fetcher, unaffected by the stale-fallback path', async () => {
      const kv = createFakeKv();
      await kv.put('k7', JSON.stringify({ v: { price: 222 }, storedAt: Date.now() }));
      let calls = 0;

      const result = await cachedFetch(kv, 'k7', 60, async () => {
        calls++;
        return { price: 999 };
      });

      expect(result.value).toEqual({ price: 222 });
      expect(result.cached).toBe(true);
      expect(calls).toBe(0);
    });

    it('a successful refetch replaces the stale value and future calls see the fresh one, not the fallback', async () => {
      const kv = createFakeKv();
      await kv.put('k8', JSON.stringify({ v: { price: 1 }, storedAt: Date.now() - 120_000 }));

      const first = await cachedFetch(kv, 'k8', 60, async () => ({ price: 2 }));
      expect(first.value).toEqual({ price: 2 }); // refetch succeeded - never fell back to stale

      let calls = 0;
      const second = await cachedFetch(kv, 'k8', 60, async () => {
        calls++;
        return { price: 3 };
      });
      expect(second.value).toEqual({ price: 2 }); // freshly-written value now served as a genuine cache hit
      expect(calls).toBe(0);
    });

    it('no stale value exists at all (genuine first-ever miss) - a fetcher failure still propagates, nothing to fall back to', async () => {
      const kv = createFakeKv();

      await expect(cachedFetch(kv, 'k9', 60, async () => {
        throw new Error('provider down');
      })).rejects.toThrow('provider down');
    });

    it('a legacy entry with no storedAt field (written before this fix) is trusted as fresh, not treated as permanently stale', async () => {
      const kv = createFakeKv();
      await kv.put('k10', JSON.stringify({ v: { price: 77 } })); // no storedAt at all
      let calls = 0;

      const result = await cachedFetch(kv, 'k10', 60, async () => {
        calls++;
        return { price: 999 };
      });

      expect(result.value).toEqual({ price: 77 });
      expect(calls).toBe(0);
    });
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
