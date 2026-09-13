import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAdminUsersGet } from '../src/admin/admin-users-routes';
import type { Env } from '../src/types';
import { createFakeD1 } from './fakes';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeEnv(): Env {
  const { db } = createFakeD1();
  return {
    MKR_DB: db,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key-not-real',
  } as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Regression test for the production "Unexpected server error." on
 * GET /api/mkr/admin/users, reported 2026-09-13. Root cause: when the
 * Supabase Auth Admin API's listUsers page comes back EMPTY (a real, live
 * state - a fresh project with zero or currently-unconfirmed accounts),
 * `ids` is `[]`, and the old code built `user_id=in.(${ids.join(',') ||
 * 'null'})` for the alerts/devices batch queries - producing
 * `user_id=in.(null)` against a `uuid` column, which PostgREST rejects
 * with 400 ("invalid input syntax for type uuid"). `supabaseSelect` throws
 * a plain Error on any non-2xx response, uncaught here, so it surfaced as
 * a generic 500 with zero detail.
 */
it('does not throw when the Supabase project currently has zero users', async () => {
  const env = makeEnv();
  const fetchSpy = vi.fn(async (url: string) => {
    if (url.includes('/auth/v1/admin/users')) return jsonRes({ users: [] }); // real, live-possible state
    if (url.includes('user_id=in.(null)')) return jsonRes({ code: '22P02', message: 'invalid input syntax for type uuid: "null"' }, 400);
    return jsonRes([]);
  });
  vi.stubGlobal('fetch', fetchSpy);

  const response = await handleAdminUsersGet(new Request('https://x/api/mkr/admin/users'), env);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { configured: boolean; users: unknown[] } };
  expect(body.data.configured).toBe(true);
  expect(body.data.users).toEqual([]);
});

describe('filterAndSortUsers scan path with zero users', () => {
  it('also does not throw when a filtered/sorted request scans zero users', async () => {
    const env = makeEnv();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/admin/users')) return jsonRes({ users: [] });
      if (url.includes('in.(null)')) return jsonRes({ code: '22P02', message: 'invalid input syntax for type uuid: "null"' }, 400);
      return jsonRes([]);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleAdminUsersGet(new Request('https://x/api/mkr/admin/users?status=active'), env);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(true);
  });
});
