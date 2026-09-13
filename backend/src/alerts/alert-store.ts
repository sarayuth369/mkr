import { supabaseConfigFrom, supabaseInsert, supabaseSelect, supabaseUpdate } from '../supabase/supabase-client';
import type { Env } from '../types';
import type { DeviceRow } from './types';

/** All best-effort, try/catch-swallowed at the call site in alert-engine.ts -
 * a Supabase hiccup must never crash tick evaluation or duplicate-suppress
 * an alert that already fired locally. */

export async function fetchActiveDevices(env: Env, userId: string): Promise<DeviceRow[]> {
  const config = supabaseConfigFrom(env);
  if (!config) return [];
  return supabaseSelect<DeviceRow>(config, 'devices', `?user_id=eq.${encodeURIComponent(userId)}&active=eq.true&select=*`);
}

export async function persistLastTriggered(env: Env, alertId: string, triggeredAtIso: string): Promise<void> {
  const config = supabaseConfigFrom(env);
  if (!config) return;
  await supabaseUpdate(config, 'alerts', `id=eq.${encodeURIComponent(alertId)}`, { last_triggered_at: triggeredAtIso });
}

export interface NotificationLogEntry {
  userId: string;
  alertId: string | null;
  deviceId: string | null;
  title: string;
  body: string;
  status: 'sent' | 'failed';
  errorMessage?: string | null;
}

export async function logNotification(env: Env, entry: NotificationLogEntry): Promise<void> {
  const config = supabaseConfigFrom(env);
  if (!config) return;
  await supabaseInsert(config, 'notification_logs', [
    {
      user_id: entry.userId,
      alert_id: entry.alertId,
      device_id: entry.deviceId,
      title: entry.title,
      body: entry.body,
      status: entry.status,
      provider: 'fcm',
      error_message: entry.errorMessage ?? null,
    },
  ]);
}
