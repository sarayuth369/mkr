import { describe, expect, it } from 'vitest';
import { createSessionToken, requireAdmin, verifyPassword, verifySessionToken } from '../src/admin/auth';
import { ApiError } from '../src/errors';
import type { Env } from '../src/types';

const SECRET = 'test-session-secret-do-not-use-in-prod';

describe('session tokens', () => {
  it('a freshly created token verifies successfully', async () => {
    const { token } = await createSessionToken(SECRET);
    expect(await verifySessionToken(SECRET, token)).toBe(true);
  });

  it('a token signed with a different secret does not verify', async () => {
    const { token } = await createSessionToken(SECRET);
    expect(await verifySessionToken('a-different-secret', token)).toBe(false);
  });

  it('a tampered payload does not verify', async () => {
    const { token } = await createSessionToken(SECRET);
    const [, sig] = token.split('.');
    const tampered = `${btoa(JSON.stringify({ iat: 0, exp: Date.now() + 999999 }))}.${sig}`;
    expect(await verifySessionToken(SECRET, tampered)).toBe(false);
  });

  it('a malformed token does not verify and does not throw', async () => {
    expect(await verifySessionToken(SECRET, 'not-a-real-token')).toBe(false);
  });
});

describe('verifyPassword', () => {
  it('accepts the exact matching password', () => {
    expect(verifyPassword('correct-horse', 'correct-horse')).toBe(true);
  });

  it('rejects any mismatch', () => {
    expect(verifyPassword('wrong', 'correct-horse')).toBe(false);
  });
});

describe('requireAdmin', () => {
  const baseEnv = { ADMIN_SESSION_SECRET: SECRET } as Env;

  it('rejects a request with no Authorization header', async () => {
    const request = new Request('https://example.com/api/mkr/admin/dashboard');
    await expect(requireAdmin(request, baseEnv)).rejects.toBeInstanceOf(ApiError);
  });

  it('accepts a request with a valid Bearer session token', async () => {
    const { token } = await createSessionToken(SECRET);
    const request = new Request('https://example.com/api/mkr/admin/dashboard', { headers: { Authorization: `Bearer ${token}` } });
    await expect(requireAdmin(request, baseEnv)).resolves.toBeUndefined();
  });

  it('reports ADMIN_FORBIDDEN when auth is not configured at all', async () => {
    const request = new Request('https://example.com/api/mkr/admin/dashboard');
    try {
      await requireAdmin(request, {} as Env);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('ADMIN_FORBIDDEN');
    }
  });
});
