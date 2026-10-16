// AuthStore Durable Object: the ONE place that persists the owner's password hash and the session version.
//
//  * Passwords are never stored in plaintext: PBKDF2-HMAC-SHA256 (100 000 iterations - the Workers maximum) + 16-byte random salt.
//    Plaintext and hashes are never logged and never returned to any caller.
//  * Migration: until the first change, the existing Worker secret MINVEST_PASSWORD is the password (no data to migrate).
//    After a change the stored hash wins and the secret is no longer accepted - unless the owner deliberately bumps the Worker
//    secret MINVEST_PASSWORD_EPOCH (recovery path: the secret password works again and the stored hash is superseded).
//  * Session versioning: `ver` increments on every change; sessions carry the `v` they were issued under, so a change revokes all
//    older sessions at once.
//  * Brute force: >= 10 failures in 15 minutes (login OR password change, any IP) -> temporarily locked.
import { safeEqual } from './auth';
import { checkPassword } from './password-policy';
import type { Env } from './types';

const ITERATIONS = 100_000;
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const enc = new TextEncoder();

interface Stored { algo: 'pbkdf2-sha256'; iter: number; salt: string; hash: string; epoch: string; changedAt: number }
interface Storage { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> }

const b64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ (b[i] ?? 0);
  return diff === 0;
}
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });

export class AuthStore {
  constructor(private state: { storage: Storage }, private env: Env, private now: () => number = Date.now) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = (request.method === 'POST' ? await request.json().catch(() => ({})) : {}) as Record<string, unknown>;
    if (path === '/verify') return json(await this.verify(String(body.password ?? '')));
    if (path === '/session') return json({ ver: await this.version(), source: (await this.activeStored()) ? 'stored' : 'env' });
    if (path === '/change') return json(await this.change(String(body.current ?? ''), String(body.next ?? '')));
    return new Response('not found', { status: 404 });
  }

  private async version(): Promise<number> { return (await this.state.storage.get<number>('ver')) ?? 0; }

  private async activeStored(): Promise<Stored | null> {
    const s = await this.state.storage.get<Stored>('pw');
    return s && s.epoch === (this.env.MINVEST_PASSWORD_EPOCH ?? '') ? s : null;
  }

  private async matches(password: string): Promise<boolean> {
    if (!password || password.length > 256) return false;
    const stored = await this.activeStored();
    if (stored) return equalBytes(await derive(password, unb64(stored.salt), stored.iter), unb64(stored.hash));
    if (!this.env.MINVEST_PASSWORD || !this.env.MINVEST_SESSION_SECRET) return false;
    return safeEqual(password, this.env.MINVEST_PASSWORD, this.env.MINVEST_SESSION_SECRET);
  }

  private async lockedFor(): Promise<number> {
    const now = this.now();
    const fails = ((await this.state.storage.get<number[]>('fails')) ?? []).filter((t) => now - t < WINDOW_MS);
    return fails.length >= MAX_FAILS ? Math.ceil((fails[0]! + WINDOW_MS - now) / 1000) : 0;
  }
  private async recordFail() {
    const now = this.now();
    const fails = ((await this.state.storage.get<number[]>('fails')) ?? []).filter((t) => now - t < WINDOW_MS);
    fails.push(now);
    await this.state.storage.put('fails', fails.slice(-50));
  }
  private clearFails() { return this.state.storage.put('fails', []); }

  private async verify(password: string) {
    const wait = await this.lockedFor();
    if (wait > 0) return { ok: false, locked: true, retryAfter: wait };
    if (!(await this.matches(password))) { await this.recordFail(); return { ok: false }; }
    await this.clearFails();
    return { ok: true, ver: await this.version() };
  }

  private async change(current: string, next: string) {
    const wait = await this.lockedFor();
    if (wait > 0) return { ok: false, locked: true, retryAfter: wait };
    if (!(await this.matches(current))) { await this.recordFail(); return { ok: false, code: 'INVALID_CURRENT' }; }
    if (current === next) return { ok: false, code: 'SAME_PASSWORD' };
    const policy = checkPassword(next);
    if (!policy.ok) return { ok: false, code: 'WEAK_PASSWORD', reasons: policy.reasons };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(next, salt, ITERATIONS);
    const ver = (await this.version()) + 1;
    await this.state.storage.put('pw', { algo: 'pbkdf2-sha256', iter: ITERATIONS, salt: b64(salt), hash: b64(hash), epoch: this.env.MINVEST_PASSWORD_EPOCH ?? '', changedAt: this.now() } satisfies Stored);
    await this.state.storage.put('ver', ver);
    await this.clearFails();
    return { ok: true, ver };
  }
}
