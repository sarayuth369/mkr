import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { createFakeD1, createFakeKv } from './fakes';

/** Router-level proof that the new user-management routes sit behind the
 * same generic `requireAdmin` gate as every other admin route (see
 * routeAdmin() in src/index.ts calling requireAdmin() before any
 * path-specific dispatch) - not a special case that could be missed. */
describe('new user-management routes require admin auth', () => {
  const { db } = createFakeD1();
  const baseEnv = {
    MKR_DB: db,
    MKR_CACHE: createFakeKv(),
    ADMIN_SESSION_SECRET: 'test-secret',
    ADMIN_WEB_ORIGIN: 'https://admin.example.com',
  } as Env;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

  it('GET /admin/users/:id without a session token returns 401, never reaching Supabase', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://x/api/mkr/admin/users/11111111-1111-1111-1111-111111111111'),
      baseEnv,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('POST /admin/users/:id/suspend without a session token returns 401, never reaching Supabase', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://x/api/mkr/admin/users/11111111-1111-1111-1111-111111111111/suspend', { method: 'POST' }),
      baseEnv,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('DELETE /admin/users/:id without a session token returns 401, never reaching Supabase', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await worker.fetch(
      new Request('https://x/api/mkr/admin/users/11111111-1111-1111-1111-111111111111', { method: 'DELETE' }),
      baseEnv,
      ctx,
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
