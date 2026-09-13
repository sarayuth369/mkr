import { ApiError, jsonResponse } from '../errors';
import {
  supabaseAuthAdminDeleteUser,
  supabaseAuthAdminGetUser,
  supabaseAuthAdminListUsers,
  supabaseAuthAdminUpdateUser,
  supabaseConfigFrom,
  supabaseSelect,
  supabaseUpdate,
  type SupabaseAuthUser,
} from '../supabase/supabase-client';
import type { Env } from '../types';
import { recordAuditEntry } from './audit-log';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// GoTrue's raw admin API has no server-side email search/sort (see
// supabase-client.ts doc comment) - a search/sort request scans up to this
// many pages of the real per-page size (below) instead of the whole user
// base. Bounded, honest, and matches this codebase's existing "acceptable
// at early-stage volume, document the scalability path" pattern (see
// countByUserId below, and CandleCache's own doc comment) rather than
// guessing at an unsupported API capability.
const MAX_SCAN_PAGES = 5;
const PAGE_SIZE = 50;

function notConfigured() {
  return jsonResponse({ configured: false, message: 'Supabase is not configured on this deployment.' });
}

function countByUserId(rows: { user_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  return counts;
}

function isSuspended(user: SupabaseAuthUser): boolean {
  if (!user.banned_until) return false;
  return Date.parse(user.banned_until) > Date.now();
}

interface UsersQuery {
  page: number;
  q: string | null;
  status: 'active' | 'suspended' | null;
  emailConfirmed: boolean | null;
  sort: 'created_desc' | 'created_asc' | 'lastSignIn_desc' | 'lastSignIn_asc';
}

/** Pure - directly unit-tested without any network. */
export function parseUsersQuery(url: URL): UsersQuery {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const q = url.searchParams.get('q')?.trim().toLowerCase() || null;
  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'active' || statusParam === 'suspended' ? statusParam : null;
  const emailConfirmedParam = url.searchParams.get('emailConfirmed');
  const emailConfirmed = emailConfirmedParam === 'true' ? true : emailConfirmedParam === 'false' ? false : null;
  const sortParam = url.searchParams.get('sort');
  const sort = (['created_desc', 'created_asc', 'lastSignIn_desc', 'lastSignIn_asc'] as const).includes(sortParam as never)
    ? (sortParam as UsersQuery['sort'])
    : 'created_desc';
  return { page, q, status, emailConfirmed, sort };
}

/** Pure - directly unit-tested without any network. */
export function filterAndSortUsers(users: SupabaseAuthUser[], query: UsersQuery): SupabaseAuthUser[] {
  let result = users;
  if (query.q) result = result.filter((u) => (u.email ?? '').toLowerCase().includes(query.q!));
  if (query.status) result = result.filter((u) => (query.status === 'suspended' ? isSuspended(u) : !isSuspended(u)));
  if (query.emailConfirmed !== null) result = result.filter((u) => Boolean(u.email_confirmed_at) === query.emailConfirmed);

  const sorted = [...result];
  sorted.sort((a, b) => {
    const [field, dir] = query.sort.startsWith('created') ? ['created_at', query.sort] : ['last_sign_in_at', query.sort];
    const av = field === 'created_at' ? a.created_at : a.last_sign_in_at;
    const bv = field === 'created_at' ? b.created_at : b.last_sign_in_at;
    const at = av ? Date.parse(av) : 0;
    const bt = bv ? Date.parse(bv) : 0;
    return dir.endsWith('desc') ? bt - at : at - bt;
  });
  return sorted;
}

/**
 * "Guest" is explicitly a client-side-only concept (spec 2.4-A) - every row
 * here comes from Supabase Auth's real user list, never a fabricated guest
 * account.
 *
 * Server-side pagination against the GoTrue Admin API's own `page`/
 * `per_page`: with no search/status/emailConfirmed/sort filter, this is a
 * single real page fetch (never loads the whole user base at once). A
 * search/filter/sort request instead scans up to MAX_SCAN_PAGES pages,
 * filters/sorts in memory, and paginates the *result* - bounded and
 * documented above, not a guess at an API capability that doesn't exist.
 */
export async function handleAdminUsersGet(request: Request, env: Env): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const url = new URL(request.url);
  const query = parseUsersQuery(url);
  const isFiltering = Boolean(query.q || query.status || query.emailConfirmed !== null || query.sort !== 'created_desc');

  let pageUsers: SupabaseAuthUser[];
  let hasMore: boolean;
  let allFetchedForTotals: SupabaseAuthUser[];

  if (!isFiltering) {
    const { users } = await supabaseAuthAdminListUsers(config, query.page, PAGE_SIZE);
    pageUsers = users;
    hasMore = users.length === PAGE_SIZE;
    allFetchedForTotals = users;
  } else {
    const scanned: SupabaseAuthUser[] = [];
    for (let p = 1; p <= MAX_SCAN_PAGES; p++) {
      const { users } = await supabaseAuthAdminListUsers(config, p, PAGE_SIZE);
      scanned.push(...users);
      if (users.length < PAGE_SIZE) break;
    }
    const filtered = filterAndSortUsers(scanned, query);
    const start = (query.page - 1) * PAGE_SIZE;
    pageUsers = filtered.slice(start, start + PAGE_SIZE);
    hasMore = filtered.length > start + PAGE_SIZE;
    allFetchedForTotals = filtered;
  }

  const ids = pageUsers.map((u) => u.id);
  const idFilter = ids.length > 0 ? `id=in.(${ids.join(',')})` : 'id=eq.00000000-0000-0000-0000-000000000000';
  const [profiles, alerts, devices] = await Promise.all([
    supabaseSelect<{ id: string; plan: string }>(config, 'profiles', `?select=id,plan&${idFilter}`),
    supabaseSelect<{ user_id: string }>(config, 'alerts', `?select=user_id&enabled=eq.true&user_id=in.(${ids.join(',') || 'null'})`),
    supabaseSelect<{ user_id: string }>(config, 'devices', `?select=user_id&active=eq.true&user_id=in.(${ids.join(',') || 'null'})`),
  ]);

  const planById = new Map(profiles.map((p) => [p.id, p.plan]));
  const alertCounts = countByUserId(alerts);
  const deviceCounts = countByUserId(devices);
  const now = Date.now();

  const users = pageUsers.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    plan: planById.get(u.id) ?? 'free',
    createdAt: u.created_at,
    lastActiveAt: u.last_sign_in_at ?? null,
    emailConfirmed: Boolean(u.email_confirmed_at),
    suspended: isSuspended(u),
    alertCount: alertCounts.get(u.id) ?? 0,
    deviceCount: deviceCounts.get(u.id) ?? 0,
  }));

  const totals = {
    total: allFetchedForTotals.length,
    active: allFetchedForTotals.filter((u) => u.last_sign_in_at && now - Date.parse(u.last_sign_in_at) < THIRTY_DAYS_MS).length,
    newLast30Days: allFetchedForTotals.filter((u) => now - Date.parse(u.created_at) < THIRTY_DAYS_MS).length,
    pro: users.filter((u) => u.plan !== 'free').length,
  };

  return jsonResponse({ configured: true, page: query.page, pageSize: PAGE_SIZE, hasMore, scanned: isFiltering, totals, users });
}

async function countWatchlistItems(config: NonNullable<ReturnType<typeof supabaseConfigFrom>>, userId: string): Promise<number> {
  const lists = await supabaseSelect<{ id: string }>(config, 'watchlists', `?user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (lists.length === 0) return 0;
  const idFilter = lists.map((l) => l.id).join(',');
  const items = await supabaseSelect<{ id: string }>(config, 'watchlist_items', `?watchlist_id=in.(${idFilter})&select=id`);
  return items.length;
}

/** Validates [userId] looks like a UUID before it ever reaches a Supabase
 * call - never trust a browser-supplied id format. */
function assertValidUserId(userId: string): void {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(userId)) throw new ApiError('INVALID_PARAMETER', 'Invalid user id.');
}

export async function handleAdminUserDetail(_request: Request, env: Env, userId: string): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();
  assertValidUserId(userId);

  const [authUser, profileRows, alerts, devices, watchlistCount, subscriptionRows] = await Promise.all([
    supabaseAuthAdminGetUser(config, userId),
    supabaseSelect<{ id: string; display_name: string | null; plan: string; created_at: string }>(
      config,
      'profiles',
      `?id=eq.${encodeURIComponent(userId)}&select=*`,
    ),
    supabaseSelect(config, 'alerts', `?user_id=eq.${encodeURIComponent(userId)}&enabled=eq.true&select=id,symbol,condition_type,target_value`),
    supabaseSelect(config, 'devices', `?user_id=eq.${encodeURIComponent(userId)}&select=id,platform,active,updated_at`),
    countWatchlistItems(config, userId),
    supabaseSelect(config, 'subscriptions', `?user_id=eq.${encodeURIComponent(userId)}&select=plan,status,expires_at&order=updated_at.desc&limit=1`),
  ]);

  const profile = profileRows[0] ?? null;
  if (!authUser || !profile) return jsonResponse({ configured: true, found: false });

  return jsonResponse({
    configured: true,
    found: true,
    // Auth fields shown are deliberately limited to what's safe/useful -
    // never a password hash, MFA secret, or raw provider token.
    auth: {
      id: authUser.id,
      email: authUser.email ?? null,
      emailConfirmed: Boolean(authUser.email_confirmed_at),
      suspended: isSuspended(authUser),
      createdAt: authUser.created_at,
      lastSignInAt: authUser.last_sign_in_at ?? null,
      userMetadata: authUser.user_metadata ?? {},
    },
    profile,
    watchlistItemCount: watchlistCount,
    activeAlerts: alerts,
    devices,
    subscription: subscriptionRows[0] ?? null,
  });
}

/**
 * Edits an Auth user's email (always re-requiring confirmation of the new
 * address - never silently treats an admin-typed email as pre-verified,
 * so Auth/profile never disagree about whether it's actually confirmed)
 * and/or the profile's display_name (the only free-text profile column
 * that exists - see supabase/migrations/20260913000000_initial_schema.sql;
 * nothing else on `profiles` is admin-editable).
 */
export async function handleAdminUserUpdate(request: Request, env: Env, userId: string, actor: string): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();
  assertValidUserId(userId);

  const body = (await request.json().catch(() => null)) as { email?: string; displayName?: string } | null;
  if (!body || (body.email === undefined && body.displayName === undefined)) {
    throw new ApiError('INVALID_PARAMETER', 'email and/or displayName is required');
  }

  const before = await supabaseAuthAdminGetUser(config, userId);
  if (!before) throw new ApiError('NOT_FOUND', 'User not found');

  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (body.email !== undefined && body.email !== before.email) {
    await supabaseAuthAdminUpdateUser(config, userId, { email: body.email, email_confirm: false });
    changes.email = { old: before.email ?? null, new: body.email };
  }
  if (body.displayName !== undefined) {
    const beforeProfile = await supabaseSelect<{ display_name: string | null }>(
      config,
      'profiles',
      `?id=eq.${encodeURIComponent(userId)}&select=display_name`,
    );
    await supabaseUpdate(config, 'profiles', `id=eq.${encodeURIComponent(userId)}`, { display_name: body.displayName });
    changes.displayName = { old: beforeProfile[0]?.display_name ?? null, new: body.displayName };
  }

  await recordAuditEntry(env, {
    actor,
    action: 'USER_UPDATED',
    target: userId,
    oldValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.old])),
    newValue: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.new])),
  });

  return jsonResponse({ configured: true, updated: Object.keys(changes) });
}

const SUSPEND_DURATION = '876000h'; // ~100 years - GoTrue's own convention for an effectively indefinite ban
const UNSUSPEND_DURATION = 'none'; // GoTrue's documented sentinel to clear a ban

/**
 * Suspension uses GoTrue's native `ban_duration` (via the Admin API's
 * updateUserById/PUT), NOT a hidden-in-the-UI flag - a banned user is
 * actually rejected by Supabase Auth on sign-in, per Supabase's own
 * ban/unban mechanism (there is no separate "suspended" column; this is
 * the supported mechanism for the current Supabase version/project).
 */
export async function handleAdminUserSuspend(_request: Request, env: Env, userId: string, actor: string): Promise<Response> {
  return setSuspended(env, userId, actor, true);
}

export async function handleAdminUserUnsuspend(_request: Request, env: Env, userId: string, actor: string): Promise<Response> {
  return setSuspended(env, userId, actor, false);
}

async function setSuspended(env: Env, userId: string, actor: string, suspend: boolean): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();
  assertValidUserId(userId);

  const before = await supabaseAuthAdminGetUser(config, userId);
  if (!before) throw new ApiError('NOT_FOUND', 'User not found');
  const wasSuspended = isSuspended(before);

  const updated = await supabaseAuthAdminUpdateUser(config, userId, {
    ban_duration: suspend ? SUSPEND_DURATION : UNSUSPEND_DURATION,
  });

  await recordAuditEntry(env, {
    actor,
    action: suspend ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
    target: userId,
    oldValue: { suspended: wasSuspended },
    newValue: { suspended: isSuspended(updated) },
  });

  return jsonResponse({ configured: true, suspended: isSuspended(updated) });
}

/**
 * Hard-deletes the Auth user via the Admin API. Every MKR table cascades
 * from `auth.users(id)` (verified against the applied migration - see
 * supabase-client.ts's doc comment on supabaseAuthAdminDeleteUser), so this
 * one call also removes profiles/watchlists/watchlist_items/alerts/devices/
 * preferences/subscriptions/notification_logs for that user. Never
 * `DELETE FROM profiles` directly - that would orphan the Auth user.
 *
 * Requires the admin to type the exact target email as `confirmEmail` in
 * the request body - re-validated here server-side (never trusting the
 * Admin Web UI's own confirmation-typing check alone) before the
 * irreversible call is made.
 */
export async function handleAdminUserDelete(request: Request, env: Env, userId: string, actor: string): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();
  assertValidUserId(userId);

  const body = (await request.json().catch(() => null)) as { confirmEmail?: string } | null;
  if (!body?.confirmEmail) throw new ApiError('INVALID_PARAMETER', 'confirmEmail is required to delete a user');

  const target = await supabaseAuthAdminGetUser(config, userId);
  if (!target) throw new ApiError('NOT_FOUND', 'User not found');
  if (!target.email || body.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
    throw new ApiError('INVALID_PARAMETER', 'confirmEmail does not match this user\'s email');
  }

  await supabaseAuthAdminDeleteUser(config, userId);

  await recordAuditEntry(env, {
    actor,
    action: 'USER_DELETED',
    target: userId,
    oldValue: { email: target.email },
    newValue: null,
  });

  return jsonResponse({ configured: true, deleted: true });
}
