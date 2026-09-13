import { getConfig } from '../config/config-service';
import { getPushProvider } from '../push/provider-factory';
import type { Env } from '../types';
import { fetchActiveDevices, logNotification, persistLastTriggered } from './alert-store';
import { getAlertIndex } from './alert-index';
import type { AlertRow } from './types';

// Per-isolate guard against the SAME alert firing twice from two ticks that
// arrive microseconds apart, before either trigger's Supabase write has
// round-tripped (spec 2.3-F: "prevent duplicate concurrent triggers").
const triggering = new Set<string>();

/** Pure - no I/O - so this is trivially unit-testable without a Supabase or
 * KV fake (see backend/test/alert-engine.test.ts). */
export function conditionMet(row: Pick<AlertRow, 'condition_type' | 'target_value'>, price: number): boolean {
  if (row.condition_type === 'price_above') return price > row.target_value;
  if (row.condition_type === 'price_below') return price < row.target_value;
  return false;
}

/** Pure. `nowMs`/`lastTriggeredAtIso` kept as explicit params (not `Date.now()`
 * inside) so tests can pin exact boundary timing. */
export function isCooledDown(lastTriggeredAtIso: string | null, cooldownSeconds: number, nowMs: number): boolean {
  if (!lastTriggeredAtIso) return true;
  const lastMs = Date.parse(lastTriggeredAtIso);
  if (Number.isNaN(lastMs)) return true;
  return nowMs - lastMs >= cooldownSeconds * 1000;
}

/**
 * Called from MarketStreamRoom.handleUpstreamMessage for EVERY tick of the
 * one shared upstream connection - independent of whether any Flutter
 * client is currently connected, satisfying "alert evaluation must not
 * depend on Flutter being open". Reads only the KV-cached [AlertIndex]
 * (see alert-index.ts), never Supabase directly, so this never becomes a
 * per-tick-per-user Supabase query.
 */
export async function evaluateTick(env: Env, symbol: string, price: number): Promise<void> {
  try {
    const flags = (await getConfig(env)).featureFlags;
    if (!flags.alertsEnabled) return;

    const index = await getAlertIndex(env);
    if (!index) return; // Supabase/alert engine not configured - nothing to evaluate

    const rows = index.bySymbol[symbol];
    if (!rows || rows.length === 0) return;
    const now = Date.now();

    for (const row of rows) {
      if (!row.enabled) continue;
      if (!conditionMet(row, price)) continue;
      if (!isCooledDown(row.last_triggered_at, row.cooldown_seconds, now)) continue;
      if (triggering.has(row.id)) continue;

      triggering.add(row.id);
      void triggerAlert(env, row, price, now).finally(() => triggering.delete(row.id));
    }
  } catch {
    // Alert evaluation must never take down tick fan-out to connected
    // Flutter clients - swallow and let the next tick retry.
  }
}

async function triggerAlert(env: Env, row: AlertRow, price: number, nowMs: number): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  // Update the in-memory copy immediately so a tick arriving a moment later
  // in this same isolate also sees the fresh cooldown, without waiting for
  // Supabase's write to round-trip.
  row.last_triggered_at = nowIso;

  const title = row.symbol;
  const directionLabel = row.condition_type === 'price_above' ? 'above' : 'below';
  const body = `${row.symbol} is ${directionLabel} ${row.target_value} (now ${price})`;

  const flags = (await getConfig(env)).featureFlags;
  const provider = flags.pushNotificationsEnabled ? getPushProvider(env) : null;
  const devices = await fetchActiveDevices(env, row.user_id).catch(() => []);

  if (!provider || !provider.isConfigured || devices.length === 0) {
    await logNotification(env, {
      userId: row.user_id,
      alertId: row.id,
      deviceId: null,
      title,
      body,
      status: 'failed',
      errorMessage: !provider || !provider.isConfigured ? 'push_not_configured' : 'no_active_device',
    }).catch(() => {});
  } else {
    for (const device of devices) {
      const result = await provider.send({ token: device.fcm_token }, { title, body, data: { symbol: row.symbol, alertId: row.id } });
      await logNotification(env, {
        userId: row.user_id,
        alertId: row.id,
        deviceId: device.id,
        title,
        body,
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.error ?? null,
      }).catch(() => {});
    }
  }

  await persistLastTriggered(env, row.id, nowIso).catch(() => {});
}
