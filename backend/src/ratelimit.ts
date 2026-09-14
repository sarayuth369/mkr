import { logError } from './logging';
import type { Env } from './types';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window limiter backed by a Durable Object (see ratelimit-do.ts),
 * sharded one DO instance per key - NOT backed by KV. KV was the original
 * design but produced one KV .put() per allowed request, which alone
 * exceeded the Workers KV free-tier 1,000 PUT/day quota under any real
 * traffic (see docs/architecture/MKR_MARKET_DATA_ARCHITECTURE_DECISIONS.md,
 * Phase 0.B). The DO shard holds its window counter purely in memory - zero
 * KV writes, zero DO storage writes, and stronger consistency than the old
 * KV read-then-write race since each shard is single-threaded.
 *
 * Fails OPEN (allowed: true) if the DO call itself throws (e.g. a transient
 * platform error) - a rate limiter must never turn into a public API outage;
 * see the "KV 429 -> uncaught -> 500" incident this migration fixes.
 */
export async function checkRateLimit(
  namespace: DurableObjectNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  try {
    const stub = namespace.get(namespace.idFromName(key));
    const response = await stub.fetch('https://rate-limiter.internal/check', {
      method: 'POST',
      body: JSON.stringify({ limit, windowSeconds, now }),
    });
    return (await response.json()) as RateLimitResult;
  } catch (err) {
    logError('rate limiter DO call failed - failing open', { key, message: (err as Error).message });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }
}

export function clientKeyFromRequest(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
      },
    },
  );
}

export function rateLimitEnv(env: Env, kind: 'public' | 'admin'): { limit: number; windowSeconds: number } {
  const limit = Number(kind === 'public' ? env.RATE_LIMIT_PUBLIC_PER_MINUTE : env.RATE_LIMIT_ADMIN_PER_MINUTE);
  return { limit: Number.isFinite(limit) && limit > 0 ? limit : 60, windowSeconds: 60 };
}
