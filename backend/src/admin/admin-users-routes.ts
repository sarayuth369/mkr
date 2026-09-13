import { jsonResponse } from '../errors';
import { supabaseAuthAdminListUsers, supabaseConfigFrom, supabaseSelect } from '../supabase/supabase-client';
import type { Env } from '../types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function notConfigured() {
  return jsonResponse({ configured: false, message: 'Supabase is not configured on this deployment.' });
}

function countByUserId(rows: { user_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  return counts;
}

/**
 * "Guest" is explicitly a client-side-only concept (spec 2.4-A) - every row
 * here comes from Supabase Auth's real user list, never a fabricated guest
 * account. Counts/aggregates are computed in JS from small row sets
 * (`select=user_id` only) rather than a PostgREST aggregate query, which
 * keeps this correct without depending on a specific PostgREST version's
 * aggregate-function support - acceptable at early-stage user volume; a
 * proper materialized view is the documented upgrade if this ever becomes
 * a bottleneck (see docs/MKR-PHASE2-ARCHITECTURE.md).
 */
export async function handleAdminUsersGet(_request: Request, env: Env): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const [{ users: authUsers }, profiles, alerts, devices] = await Promise.all([
    supabaseAuthAdminListUsers(config, 1, 200),
    supabaseSelect<{ id: string; plan: string }>(config, 'profiles', '?select=id,plan'),
    supabaseSelect<{ user_id: string }>(config, 'alerts', '?select=user_id&enabled=eq.true'),
    supabaseSelect<{ user_id: string }>(config, 'devices', '?select=user_id&active=eq.true'),
  ]);

  const planById = new Map(profiles.map((p) => [p.id, p.plan]));
  const alertCounts = countByUserId(alerts);
  const deviceCounts = countByUserId(devices);
  const now = Date.now();

  const users = authUsers.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    plan: planById.get(u.id) ?? 'free',
    createdAt: u.created_at,
    lastActiveAt: u.last_sign_in_at ?? null,
    alertCount: alertCounts.get(u.id) ?? 0,
    deviceCount: deviceCounts.get(u.id) ?? 0,
  }));

  const totals = {
    total: users.length,
    active: users.filter((u) => u.lastActiveAt && now - Date.parse(u.lastActiveAt) < THIRTY_DAYS_MS).length,
    newLast30Days: users.filter((u) => now - Date.parse(u.createdAt) < THIRTY_DAYS_MS).length,
    pro: users.filter((u) => u.plan !== 'free').length,
  };

  return jsonResponse({ configured: true, totals, users });
}

async function countWatchlistItems(config: NonNullable<ReturnType<typeof supabaseConfigFrom>>, userId: string): Promise<number> {
  const lists = await supabaseSelect<{ id: string }>(config, 'watchlists', `?user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (lists.length === 0) return 0;
  const idFilter = lists.map((l) => l.id).join(',');
  const items = await supabaseSelect<{ id: string }>(config, 'watchlist_items', `?watchlist_id=in.(${idFilter})&select=id`);
  return items.length;
}

export async function handleAdminUserDetail(_request: Request, env: Env, userId: string): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const [profileRows, alerts, devices, watchlistCount, subscriptionRows] = await Promise.all([
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
  if (!profile) return jsonResponse({ configured: true, found: false });

  return jsonResponse({
    configured: true,
    found: true,
    profile,
    watchlistItemCount: watchlistCount,
    activeAlerts: alerts,
    devices,
    subscription: subscriptionRows[0] ?? null,
  });
}
