/**
 * Durable-Object-backed fixed-window rate limiter - replaces the old
 * KV-backed counter in ratelimit.ts (see docs/architecture/
 * MKR_MARKET_DATA_ARCHITECTURE_DECISIONS.md, Phase 0.B for why). Sharded
 * one DO instance per rate-limit key (`idFromName(key)`, see
 * checkRateLimit in ratelimit.ts) - each instance holds its own window
 * counter purely in memory, never touching KV or Durable Object storage.
 *
 * Correctness note: an idle DO instance can be evicted by the platform,
 * which resets its in-memory counter to zero. That is an ACCEPTED,
 * intentional tradeoff for a rate limiter - eviction only happens after a
 * period of no traffic from that key, so the client wasn't near the limit
 * anyway; the failure mode is "occasionally slightly more permissive after
 * a long idle gap", never a security-relevant under-limiting bug. This is
 * also strictly stronger than the old KV approach for the case that
 * matters: while the instance IS alive, DO single-threaded execution
 * removes the eventually-consistent-read race the old KV counter had
 * under concurrent requests in the same window.
 */
export interface RateLimitDoResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface RateLimitDoRequest {
  limit: number;
  windowSeconds: number;
  now: number;
}

export class RateLimiterRoom {
  private windowStart = 0;
  private count = 0;

  // DurableObjectState/Env are accepted for signature-compatibility with
  // the Cloudflare DO constructor contract; this room needs neither -
  // state is intentionally in-memory only (see class doc above).
  constructor(_state?: unknown, _env?: unknown) {}

  async fetch(request: Request): Promise<Response> {
    let body: RateLimitDoRequest;
    try {
      body = (await request.json()) as RateLimitDoRequest;
    } catch {
      return Response.json({ allowed: false, remaining: 0, resetAt: Date.now() } satisfies RateLimitDoResult, { status: 400 });
    }

    const { limit, windowSeconds, now } = body;
    const windowMs = Math.max(1, windowSeconds) * 1000;
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = currentWindowStart + windowMs;

    if (currentWindowStart !== this.windowStart) {
      this.windowStart = currentWindowStart;
      this.count = 0;
    }

    if (this.count >= limit) {
      return Response.json({ allowed: false, remaining: 0, resetAt } satisfies RateLimitDoResult);
    }

    this.count += 1;
    return Response.json({ allowed: true, remaining: Math.max(0, limit - this.count), resetAt } satisfies RateLimitDoResult);
  }
}
