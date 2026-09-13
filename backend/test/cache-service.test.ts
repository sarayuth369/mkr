import { describe, expect, it } from 'vitest';
import { _resetInFlightForTests, cachedFetch } from '../src/cache/cache-service';
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
});
