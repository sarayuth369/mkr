import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '../src/ratelimit';
import { createFakeRateLimiterNamespace } from './fakes';

describe('checkRateLimit', () => {
  it('allows requests up to the limit within a window', async () => {
    const ns = createFakeRateLimiterNamespace();
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(ns, 'client-a', 5, 60, now);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the request once the limit is exceeded within the same window', async () => {
    const ns = createFakeRateLimiterNamespace();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await checkRateLimit(ns, 'client-b', 5, 60, now);
    const sixth = await checkRateLimit(ns, 'client-b', 5, 60, now);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it('resets once a new window starts', async () => {
    const ns = createFakeRateLimiterNamespace();
    const windowMs = 60_000;
    const t0 = Math.floor(Date.now() / windowMs) * windowMs;
    for (let i = 0; i < 5; i++) await checkRateLimit(ns, 'client-c', 5, 60, t0);
    const blocked = await checkRateLimit(ns, 'client-c', 5, 60, t0);
    expect(blocked.allowed).toBe(false);

    const nextWindow = t0 + windowMs;
    const allowedAgain = await checkRateLimit(ns, 'client-c', 5, 60, nextWindow);
    expect(allowedAgain.allowed).toBe(true);
  });

  it('tracks separate clients independently (separate DO shards)', async () => {
    const ns = createFakeRateLimiterNamespace();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await checkRateLimit(ns, 'client-d', 5, 60, now);
    const otherClient = await checkRateLimit(ns, 'client-e', 5, 60, now);
    expect(otherClient.allowed).toBe(true);
  });

  it('handles concurrent requests for the same key correctly - DO shard is single-threaded, no lost increments', async () => {
    const ns = createFakeRateLimiterNamespace();
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 10 }, () => checkRateLimit(ns, 'client-concurrent', 5, 60, now)));
    expect(results.filter((r) => r.allowed).length).toBe(5);
    expect(results.filter((r) => !r.allowed).length).toBe(5);
  });

  it('never performs a KV write - no KVNamespace is even reachable from this call path', async () => {
    // Type-level guarantee: checkRateLimit's signature takes a
    // DurableObjectNamespace, not a KVNamespace, so this is also enforced
    // at compile time - this test documents the behavioral intent.
    const ns = createFakeRateLimiterNamespace();
    const result = await checkRateLimit(ns, 'client-f', 5, 60, Date.now());
    expect(result.allowed).toBe(true);
  });

  it('fails OPEN (does not turn into a 500) if the DO call itself throws', async () => {
    const throwingNamespace = {
      idFromName: () => ({ toString: () => 'x' }) as unknown,
      get: () => ({
        fetch: () => {
          throw new Error('simulated platform error');
        },
      }),
    } as unknown as DurableObjectNamespace;

    const result = await checkRateLimit(throwingNamespace, 'client-g', 5, 60, Date.now());
    expect(result.allowed).toBe(true);
  });
});
