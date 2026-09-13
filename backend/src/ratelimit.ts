import type { Env } from './types';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window limiter backed by KV, shared across isolates/regions (unlike
 * a plain in-memory Map, which only protects a single isolate). KV writes
 * are eventually-consistent, so under very high concurrency a client can
 * slightly exceed the limit for one window - an accepted tradeoff for an
 * early-stage app; swapping in Cloudflare's native Workers Rate Limiting
 * binding later is a drop-in replacement for this function if stricter
 * enforcement is ever needed.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
  const resetAt = windowStart + windowSeconds * 1000;
  const storageKey = `ratelimit:${key}:${windowStart}`;

  const current = Number((await kv.get(storageKey)) ?? '0');
  if (current >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  const next = current + 1;
  await kv.put(storageKey, String(next), { expirationTtl: windowSeconds + 5 });
  return { allowed: true, remaining: Math.max(0, limit - next), resetAt };
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
