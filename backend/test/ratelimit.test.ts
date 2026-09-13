import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '../src/ratelimit';
import { createFakeKv } from './fakes';

describe('checkRateLimit', () => {
  it('allows requests up to the limit within a window', async () => {
    const kv = createFakeKv();
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(kv, 'client-a', 5, 60, now);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the request once the limit is exceeded within the same window', async () => {
    const kv = createFakeKv();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await checkRateLimit(kv, 'client-b', 5, 60, now);
    const sixth = await checkRateLimit(kv, 'client-b', 5, 60, now);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it('resets once a new window starts', async () => {
    const kv = createFakeKv();
    const windowMs = 60_000;
    const t0 = Math.floor(Date.now() / windowMs) * windowMs;
    for (let i = 0; i < 5; i++) await checkRateLimit(kv, 'client-c', 5, 60, t0);
    const blocked = await checkRateLimit(kv, 'client-c', 5, 60, t0);
    expect(blocked.allowed).toBe(false);

    const nextWindow = t0 + windowMs;
    const allowedAgain = await checkRateLimit(kv, 'client-c', 5, 60, nextWindow);
    expect(allowedAgain.allowed).toBe(true);
  });

  it('tracks separate clients independently', async () => {
    const kv = createFakeKv();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await checkRateLimit(kv, 'client-d', 5, 60, now);
    const otherClient = await checkRateLimit(kv, 'client-e', 5, 60, now);
    expect(otherClient.allowed).toBe(true);
  });
});
