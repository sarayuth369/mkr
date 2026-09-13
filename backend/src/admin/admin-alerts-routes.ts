import { ApiError, jsonResponse } from '../errors';
import { supabaseConfigFrom, supabaseSelect, supabaseUpdate } from '../supabase/supabase-client';
import type { Env } from '../types';
import { recordAuditEntry } from './audit-log';

function notConfigured() {
  return jsonResponse({ configured: false, message: 'Supabase is not configured on this deployment.' });
}

export async function handleAdminAlertsGet(request: Request, env: Env): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  const status = url.searchParams.get('status'); // 'active' | 'triggered' | 'disabled'

  const filters: string[] = ['select=*'];
  if (symbol) filters.push(`symbol=eq.${encodeURIComponent(symbol)}`);
  if (status === 'disabled') filters.push('enabled=eq.false');
  if (status === 'active' || status === 'triggered') filters.push('enabled=eq.true');

  const rows = await supabaseSelect<{
    id: string;
    user_id: string;
    symbol: string;
    condition_type: string;
    target_value: number;
    enabled: boolean;
    cooldown_seconds: number;
    last_triggered_at: string | null;
    created_at: string;
  }>(config, 'alerts', `?${filters.join('&')}`);

  const filtered = status === 'triggered' ? rows.filter((r) => r.last_triggered_at !== null) : rows;
  return jsonResponse({ configured: true, alerts: filtered });
}

/** Admin can enable/disable an alert - MUST audit-log every such change
 * (spec 2.4-C: "never silently modify user settings"). */
export async function handleAdminAlertToggle(request: Request, env: Env, actor: string): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const body = (await request.json().catch(() => null)) as { alertId?: string; enabled?: boolean } | null;
  if (!body?.alertId || typeof body.enabled !== 'boolean') {
    throw new ApiError('INVALID_PARAMETER', 'alertId and enabled (boolean) are required');
  }

  const before = await supabaseSelect<{ id: string; enabled: boolean; symbol: string }>(
    config,
    'alerts',
    `?id=eq.${encodeURIComponent(body.alertId)}&select=id,enabled,symbol`,
  );
  const beforeRow = before[0];
  if (!beforeRow) throw new ApiError('NOT_FOUND', 'Alert not found');

  const after = await supabaseUpdate(config, 'alerts', `id=eq.${encodeURIComponent(body.alertId)}`, { enabled: body.enabled });

  await recordAuditEntry(env, {
    actor,
    action: 'alert.enabled.changed',
    target: `${body.alertId} (${beforeRow.symbol})`,
    oldValue: beforeRow.enabled,
    newValue: body.enabled,
  });

  return jsonResponse({ configured: true, alert: after[0] });
}

export async function handleAdminNotificationLogs(request: Request, env: Env): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const rows = await supabaseSelect(config, 'notification_logs', `?select=*&order=sent_at.desc&limit=${limit}`);
  return jsonResponse({ configured: true, logs: rows });
}

export async function handleAdminSubscriptionsGet(_request: Request, env: Env): Promise<Response> {
  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const rows = await supabaseSelect<{ plan: string; status: string }>(config, 'subscriptions', '?select=plan,status');
  const counts: Record<string, number> = {};
  for (const row of rows) counts[`${row.plan}:${row.status}`] = (counts[`${row.plan}:${row.status}`] ?? 0) + 1;

  return jsonResponse({ configured: true, counts, total: rows.length });
}
