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

/** Auth Admin API (`/auth/v1/admin/...`) - separate base path from PostgREST, still service-role-only. */
export async function supabaseAuthAdminListUsers(config: SupabaseServiceConfig, page = 1, perPage = 200): Promise<{ users: SupabaseAuthUser[] }> {
  const response = await fetch(`${config.url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { headers: headers(config) });
  if (!response.ok) throw new Error(`Supabase auth admin list users failed: ${response.status}`);
  return (await response.json()) as { users: SupabaseAuthUser[] };
}

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
}
