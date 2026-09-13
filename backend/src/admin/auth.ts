import { ApiError } from '../errors';
import type { Env } from '../types';

interface SessionPayload {
  iat: number;
  exp: number;
}

const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * Signed, stateless session token (HMAC-SHA256 over an expiry-bearing
 * payload) - no server-side session store needed. No hardcoded admin
 * password: [ADMIN_PASSWORD] and [ADMIN_SESSION_SECRET] are both Worker
 * secrets set via `wrangler secret put`, never committed, never logged.
 */
export async function createSessionToken(sessionSecret: string): Promise<{ token: string; expiresAt: number }> {
  const now = Date.now();
  const payload: SessionPayload = { iat: now, exp: now + SESSION_TTL_SECONDS * 1000 };
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(sessionSecret), new TextEncoder().encode(payloadB64));
  const sigB64 = base64urlEncode(new Uint8Array(signature));
  return { token: `${payloadB64}.${sigB64}`, expiresAt: payload.exp };
}

export async function verifySessionToken(sessionSecret: string, token: string): Promise<boolean> {
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;

  const expectedSignature = await crypto.subtle.sign('HMAC', await hmacKey(sessionSecret), new TextEncoder().encode(payloadB64));
  const expectedB64 = base64urlEncode(new Uint8Array(expectedSignature));
  if (!timingSafeEqual(expectedB64, sigB64)) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as SessionPayload;
    return typeof payload.exp === 'number' && Date.now() < payload.exp;
  } catch {
    return false;
  }
}

export function verifyPassword(candidate: string, expected: string): boolean {
  return timingSafeEqual(candidate, expected);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

/** Middleware: throws AUTH_REQUIRED unless a valid, unexpired session token is present. */
export async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_SESSION_SECRET) {
    throw new ApiError('ADMIN_FORBIDDEN', 'Admin authentication is not configured on this deployment.');
  }
  const token = bearerToken(request);
  if (!token || !(await verifySessionToken(env.ADMIN_SESSION_SECRET, token))) {
    throw new ApiError('AUTH_REQUIRED', 'Admin authentication required.');
  }
}
