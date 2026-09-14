import { describe, expect, it } from 'vitest';
import { RateLimiterRoom } from '../src/ratelimit-do';

async function check(room: RateLimiterRoom, limit: number, windowSeconds: number, now: number) {
  const response = await room.fetch(new Request('https://rate-limiter.internal/check', { method: 'POST', body: JSON.stringify({ limit, windowSeconds, now }) }));
  return (await response.json()) as { allowed: boolean; remaining: number; resetAt: number };
}

describe('RateLimiterRoom (direct DO unit tests)', () => {
  it('allows up to the limit, then blocks within the same window', async () => {
    const room = new RateLimiterRoom();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = await check(room, 3, 60, now);
      expect(r.allowed).toBe(true);
    }
    const fourth = await check(room, 3, 60, now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('rolls the window over correctly, resetting the counter', async () => {
    const room = new RateLimiterRoom();
    const windowMs = 60_000;
    const t0 = Math.floor(Date.now() / windowMs) * windowMs;
    for (let i = 0; i < 2; i++) await check(room, 2, 60, t0);
    expect((await check(room, 2, 60, t0)).allowed).toBe(false);

    const nextWindow = t0 + windowMs;
    const afterRollover = await check(room, 2, 60, nextWindow);
    expect(afterRollover.allowed).toBe(true);
    expect(afterRollover.remaining).toBe(1);
  });

  it('reports a resetAt aligned to the fixed window boundary, not now + windowSeconds', async () => {
    const room = new RateLimiterRoom();
    const windowMs = 60_000;
    const now = Math.floor(Date.now() / windowMs) * windowMs + 30_000; // mid-window
    const r = await check(room, 5, 60, now);
    const expectedResetAt = Math.floor(now / windowMs) * windowMs + windowMs;
    expect(r.resetAt).toBe(expectedResetAt);
  });

  it('sequential calls never lose an increment - single-threaded DO semantics, no eventually-consistent read race', async () => {
    const room = new RateLimiterRoom();
    const now = Date.now();
    const results: boolean[] = [];
    for (let i = 0; i < 20; i++) results.push((await check(room, 10, 60, now)).allowed);
    expect(results.filter(Boolean).length).toBe(10);
  });

  it('holds state purely in memory - a fresh instance (simulating DO eviction) starts a clean counter', async () => {
    const room1 = new RateLimiterRoom();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await check(room1, 5, 60, now);
    expect((await check(room1, 5, 60, now)).allowed).toBe(false);

    const room2 = new RateLimiterRoom(); // simulates a fresh instance after eviction
    expect((await check(room2, 5, 60, now)).allowed).toBe(true);
  });

  it('returns a safe 400 instead of throwing on a malformed request body', async () => {
    const room = new RateLimiterRoom();
    const response = await room.fetch(new Request('https://rate-limiter.internal/check', { method: 'POST', body: 'not json' }));
    expect(response.status).toBe(400);
  });
});
