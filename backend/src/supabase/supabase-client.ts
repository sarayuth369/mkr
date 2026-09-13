import type { Env } from '../types';

/**
 * Minimal hand-rolled PostgREST client - no `@supabase/supabase-js` dependency,
 * matching the existing hand-rolled-HTTP-provider pattern already used for
 * Twelve Data/Alpaca rather than adding a new SDK for a handful of calls.
 * Always uses the service-role key (bypasses Row Level Security) - this
 * client is backend-only and must never be constructed from anything that
 * could leak into a client response.
 */
export interface SupabaseServiceConfig {
  url: string;
  serviceRoleKey: string;
}

/** `null` when Supabase isn't configured on this deployment - every caller
 * must treat that as "feature unavailable", never throw or fabricate data. */
export function supabaseConfigFrom(env: Env): SupabaseServiceConfig | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.SUPABASE_URL.replace(/\/+$/, ''), serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

function headers(config: SupabaseServiceConfig, extra?: HeadersInit): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** `query` is a raw PostgREST query string, e.g. `"?enabled=eq.true&select=*"`. */
export async function supabaseSelect<T>(config: SupabaseServiceConfig, table: string, query = '?select=*'): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${table}${query}`, { headers: headers(config) });
  if (!response.ok) throw new Error(`Supabase select on ${table} failed: ${response.status}`);
  return (await response.json()) as T[];
}

export async function supabaseInsert<T>(config: SupabaseServiceConfig, table: string, rows: unknown[]): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(config, { Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase insert on ${table} failed: ${response.status}`);
  return (await response.json()) as T[];
}

/** `match` is a raw PostgREST filter query string, e.g. `"id=eq.abc"`. */
export async function supabaseUpdate<T>(config: SupabaseServiceConfig, table: string, match: string, patch: unknown): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${table}?${match}`, {
    method: 'PATCH',
    headers: headers(config, { Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Supabase update on ${table} failed: ${response.status}`);
  return (await response.json()) as T[];
}

/**
 * Auth Admin API (`/auth/v1/admin/...`) - separate base path from
 * PostgREST, still service-role-only. GoTrue's raw admin API only accepts
 * `page`/`per_page` here - there is no server-side email search/filter or
 * sort parameter (confirmed against the auth-js SDK source, which is a
 * thin wrapper over this same endpoint). Callers needing search/sort scan
 * a bounded number of pages themselves - see admin-users-routes.ts.
 */
export async function supabaseAuthAdminListUsers(config: SupabaseServiceConfig, page = 1, perPage = 200): Promise<{ users: SupabaseAuthUser[] }> {
  const response = await fetch(`${config.url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { headers: headers(config) });
  if (!response.ok) throw new Error(`Supabase auth admin list users failed: ${response.status}`);
  return (await response.json()) as { users: SupabaseAuthUser[] };
}

export async function supabaseAuthAdminGetUser(config: SupabaseServiceConfig, userId: string): Promise<SupabaseAuthUser | null> {
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: headers(config) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Supabase auth admin get user failed: ${response.status}`);
  return (await response.json()) as SupabaseAuthUser;
}

/** `attrs` maps directly to GoTrue's `UserAttributes` PUT body - e.g.
 * `{ email, email_confirm }` to change email, `{ ban_duration }` to
 * suspend (`"876000h"`, ~100 years) or restore (`"none"`) a user. Never
 * accepts a raw password/token here - this file has no such caller. */
export async function supabaseAuthAdminUpdateUser(
  config: SupabaseServiceConfig,
  userId: string,
  attrs: Record<string, unknown>,
): Promise<SupabaseAuthUser> {
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: headers(config),
    body: JSON.stringify(attrs),
  });
  if (!response.ok) throw new Error(`Supabase auth admin update user failed: ${response.status}`);
  return (await response.json()) as SupabaseAuthUser;
}

/** Hard-deletes the `auth.users` row. Every MKR table's `user_id` foreign
 * key is `on delete cascade` to `auth.users(id)` (see
 * supabase/migrations/20260913000000_initial_schema.sql) - deleting here
 * is sufficient to also remove the user's profile/watchlists/watchlist_items/
 * alerts/devices/preferences/subscriptions/notification_logs. Never call
 * `DELETE FROM profiles` directly; that would leave an orphaned Auth user. */
export async function supabaseAuthAdminDeleteUser(config: SupabaseServiceConfig, userId: string): Promise<void> {
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: headers(config),
  });
  if (!response.ok) throw new Error(`Supabase auth admin delete user failed: ${response.status}`);
}

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  user_metadata?: Record<string, unknown>;
}
