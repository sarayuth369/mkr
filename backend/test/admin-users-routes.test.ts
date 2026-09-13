import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterAndSortUsers,
  handleAdminUserDelete,
  handleAdminUserDetail,
  handleAdminUserSuspend,
  handleAdminUserUnsuspend,
  handleAdminUserUpdate,
  handleAdminUsersGet,
  parseUsersQuery,
} from '../src/admin/admin-users-routes';
import { ApiError } from '../src/errors';
import type { SupabaseAuthUser } from '../src/supabase/supabase-client';
import type { Env } from '../src/types';
import { createFakeD1, type RecordedD1Call } from './fakes';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeEnv(overrides: Partial<Env> = {}): { env: Env; auditCalls: RecordedD1Call[] } {
  const { db, calls } = createFakeD1();
  const env = {
    MKR_DB: db,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key-not-real',
    ...overrides,
  } as Env;
  return { env, auditCalls: calls };
}

const user1: SupabaseAuthUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  created_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: '2026-02-01T00:00:00.000Z',
  email_confirmed_at: '2026-01-01T00:05:00.000Z',
  banned_until: null,
  user_metadata: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- pure query parsing / filtering (spec: list, pagination, search) ------
describe('parseUsersQuery', () => {
  it('defaults to page 1, no filters, created_desc sort', () => {
    const q = parseUsersQuery(new URL('https://x/api/mkr/admin/users'));
    expect(q).toEqual({ page: 1, q: null, status: null, emailConfirmed: null, sort: 'created_desc' });
  });

  it('parses every supported filter/sort combination', () => {
    const q = parseUsersQuery(new URL('https://x/api/mkr/admin/users?page=3&q=Alice&status=suspended&emailConfirmed=false&sort=lastSignIn_asc'));
    expect(q).toEqual({ page: 3, q: 'alice', status: 'suspended', emailConfirmed: false, sort: 'lastSignIn_asc' });
  });

  it('rejects an unrecognized status/sort value rather than passing it through', () => {
    const q = parseUsersQuery(new URL('https://x/api/mkr/admin/users?status=bogus&sort=bogus'));
    expect(q.status).toBeNull();
    expect(q.sort).toBe('created_desc');
  });

  it('never lets page go below 1', () => {
    expect(parseUsersQuery(new URL('https://x/api/mkr/admin/users?page=-5')).page).toBe(1);
    expect(parseUsersQuery(new URL('https://x/api/mkr/admin/users?page=abc')).page).toBe(1);
  });
});

describe('filterAndSortUsers', () => {
  const suspended: SupabaseAuthUser = { ...user1, id: 'u2', email: 'bob@test.com', banned_until: '2099-01-01T00:00:00.000Z', email_confirmed_at: null };
  const users = [user1, suspended];

  it('search by email is case-insensitive substring', () => {
    expect(filterAndSortUsers(users, { page: 1, q: 'alice', status: null, emailConfirmed: null, sort: 'created_desc' })).toEqual([user1]);
  });

  it('filters by suspended vs active status', () => {
    expect(filterAndSortUsers(users, { page: 1, q: null, status: 'suspended', emailConfirmed: null, sort: 'created_desc' })).toEqual([suspended]);
    expect(filterAndSortUsers(users, { page: 1, q: null, status: 'active', emailConfirmed: null, sort: 'created_desc' })).toEqual([user1]);
  });

  it('filters by email confirmation', () => {
    expect(filterAndSortUsers(users, { page: 1, q: null, status: null, emailConfirmed: false, sort: 'created_desc' })).toEqual([suspended]);
  });

  it('sorts by created date ascending/descending', () => {
    const older = { ...user1, id: 'u3', created_at: '2025-01-01T00:00:00.000Z' };
    const sortedDesc = filterAndSortUsers([older, user1], { page: 1, q: null, status: null, emailConfirmed: null, sort: 'created_desc' });
    expect(sortedDesc.map((u) => u.id)).toEqual([user1.id, 'u3']);
    const sortedAsc = filterAndSortUsers([older, user1], { page: 1, q: null, status: null, emailConfirmed: null, sort: 'created_asc' });
    expect(sortedAsc.map((u) => u.id)).toEqual(['u3', user1.id]);
  });
});

// ---- handlers (network fully mocked - never touches a real Supabase project) ----
describe('handleAdminUsersGet', () => {
  it('reports not configured, never calls fetch, when Supabase secrets are absent', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { env } = makeEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });

    const response = await handleAdminUsersGet(new Request('https://x/api/mkr/admin/users'), env);
    const body = (await response.json()) as { data: { configured: boolean } };

    expect(body.data.configured).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists a single page without scanning when no filter is applied', async () => {
    const { env } = makeEnv();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/admin/users')) return jsonRes({ users: [user1] });
      return jsonRes([]); // profiles/alerts/devices
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleAdminUsersGet(new Request('https://x/api/mkr/admin/users'), env);
    const body = (await response.json()) as { data: { configured: boolean; scanned: boolean; users: { id: string }[] } };

    expect(body.data.configured).toBe(true);
    expect(body.data.scanned).toBe(false);
    expect(body.data.users.map((u) => u.id)).toEqual([user1.id]);
    // Exactly one call to the auth admin list endpoint - no per-filter scan.
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('/auth/v1/admin/users')).length).toBe(1);
  });
});

describe('handleAdminUserDetail', () => {
  it('rejects a non-UUID user id before ever calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { env } = makeEnv();

    await expect(handleAdminUserDetail(new Request('https://x'), env, 'not-a-uuid')).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('handleAdminUserUpdate', () => {
  it('updates display_name and audit-logs the change without touching Auth', async () => {
    const { env, auditCalls } = makeEnv();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/admin/users/')) return jsonRes(user1);
      if (init?.method === 'PATCH') return jsonRes([{ display_name: 'Alice' }]);
      return jsonRes([{ display_name: 'old-name' }]);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleAdminUserUpdate(
      new Request('https://x', { method: 'PATCH', body: JSON.stringify({ displayName: 'Alice' }) }),
      env,
      user1.id,
      'admin',
    );
    const body = (await response.json()) as { data: { updated: string[] } };

    expect(body.data.updated).toEqual(['displayName']);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.args).toContain('USER_UPDATED');
    expect(JSON.stringify(auditCalls[0]!.args)).not.toMatch(/service-role|fake-service-role-key/i);
  });
});

describe('handleAdminUserSuspend / handleAdminUserUnsuspend', () => {
  it('suspends via GoTrue ban_duration and audit-logs USER_SUSPENDED', async () => {
    const { env, auditCalls } = makeEnv();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const sentBody = JSON.parse(String(init.body));
        expect(sentBody.ban_duration).toBe('876000h');
        return jsonRes({ ...user1, banned_until: '2099-01-01T00:00:00.000Z' });
      }
      return jsonRes(user1); // GET before update
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleAdminUserSuspend(new Request('https://x', { method: 'POST' }), env, user1.id, 'admin');
    const body = (await response.json()) as { data: { suspended: boolean } };

    expect(body.data.suspended).toBe(true);
    expect(auditCalls[0]!.args).toContain('USER_SUSPENDED');
  });

  it('unsuspends via ban_duration "none" and audit-logs USER_UNSUSPENDED', async () => {
    const { env, auditCalls } = makeEnv();
    const bannedUser = { ...user1, banned_until: '2099-01-01T00:00:00.000Z' };
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const sentBody = JSON.parse(String(init.body));
        expect(sentBody.ban_duration).toBe('none');
        return jsonRes({ ...user1, banned_until: null });
      }
      return jsonRes(bannedUser);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleAdminUserUnsuspend(new Request('https://x', { method: 'POST' }), env, user1.id, 'admin');
    const body = (await response.json()) as { data: { suspended: boolean } };

    expect(body.data.suspended).toBe(false);
    expect(auditCalls[0]!.args).toContain('USER_UNSUSPENDED');
  });
});

describe('handleAdminUserDelete', () => {
  it('refuses to delete when confirmEmail does not match the target user - and never calls DELETE', async () => {
    const { env, auditCalls } = makeEnv();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).not.toBe('DELETE');
      return jsonRes(user1);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      handleAdminUserDelete(
        new Request('https://x', { method: 'DELETE', body: JSON.stringify({ confirmEmail: 'wrong@example.com' }) }),
        env,
        user1.id,
        'admin',
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(auditCalls).toHaveLength(0);
  });

  it('deletes via the Auth Admin API once confirmEmail matches, and audit-logs USER_DELETED with no secrets', async () => {
    const { env, auditCalls } = makeEnv();
    let deleteWasCalled = false;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleteWasCalled = true;
        return new Response(null, { status: 200 });
      }
      return jsonRes(user1);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleAdminUserDelete(
      new Request('https://x', { method: 'DELETE', body: JSON.stringify({ confirmEmail: user1.email }) }),
      env,
      user1.id,
      'admin',
    );
    const body = (await response.json()) as { data: { deleted: boolean } };

    expect(deleteWasCalled).toBe(true);
    expect(body.data.deleted).toBe(true);
    expect(auditCalls[0]!.args).toContain('USER_DELETED');
    expect(JSON.stringify(auditCalls[0]!.args)).not.toMatch(/fake-service-role-key/i);
  });
});

// ---- self-protection (spec section 6) --------------------------------------
// N/A given the existing architecture: admin auth is one shared password
// (see src/admin/auth.ts - requireAdmin verifies only a signed session
// token, no per-admin identity at all) and is not itself a row in
// auth.users. There is no "current admin's Supabase user id" to compare a
// delete/suspend target against, so no self-protection check is added -
// inventing a multi-admin identity model to make this checkable would be
// exactly the kind of unrequested architecture change the brief forbids.
