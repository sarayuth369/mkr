import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import { logNotification } from '../alerts/alert-store';
import { getPushProvider } from '../push/provider-factory';
import { supabaseConfigFrom, supabaseSelect } from '../supabase/supabase-client';
import type { Env } from '../types';
import { recordAuditEntry } from './audit-log';

function notConfigured() {
  return jsonResponse({ configured: false, message: 'Supabase is not configured on this deployment.' });
}

async function pushDisabledResponse(env: Env) {
  const flags = (await getConfig(env)).featureFlags;
  const provider = getPushProvider(env);
  return jsonResponse({
    configured: false,
    reason: !flags.pushNotificationsEnabled ? 'feature_flag_disabled' : 'fcm_credentials_missing',
    providerConfigured: provider.isConfigured,
  });
}

/** Send a single test push to one admin-selected device - never fakes
 * success (spec: "never fake a successful push send"). */
export async function handleAdminPushTest(request: Request, env: Env, actor: string): Promise<Response> {
  const flags = (await getConfig(env)).featureFlags;
  const provider = getPushProvider(env);
  if (!flags.pushNotificationsEnabled || !provider.isConfigured) return pushDisabledResponse(env);

  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const body = (await request.json().catch(() => null)) as { deviceId?: string; title?: string; body?: string } | null;
  if (!body?.deviceId) throw new ApiError('INVALID_PARAMETER', 'deviceId is required');

  const devices = await supabaseSelect<{ id: string; user_id: string; fcm_token: string }>(
    config,
    'devices',
    `?id=eq.${encodeURIComponent(body.deviceId)}&select=id,user_id,fcm_token`,
  );
  const device = devices[0];
  if (!device) throw new ApiError('NOT_FOUND', 'Device not found');

  const title = body.title || 'MKR test notification';
  const notifBody = body.body || 'This is a test push sent from the MKR admin console.';
  const result = await provider.send({ token: device.fcm_token }, { title, body: notifBody });

  await logNotification(env, {
    userId: device.user_id,
    alertId: null,
    deviceId: device.id,
    title,
    body: notifBody,
    status: result.success ? 'sent' : 'failed',
    errorMessage: result.error ?? null,
  });
  await recordAuditEntry(env, { actor, action: 'push.test_sent', target: device.id, newValue: { success: result.success } });

  return jsonResponse({ configured: true, success: result.success, error: result.error ?? null });
}

type Audience = 'all' | 'registered' | 'pro';

async function devicesForAudience(config: NonNullable<ReturnType<typeof supabaseConfigFrom>>, audience: Audience) {
  const devices = await supabaseSelect<{ id: string; user_id: string; fcm_token: string }>(
    config,
    'devices',
    '?active=eq.true&select=id,user_id,fcm_token',
  );
  if (audience !== 'pro') return devices; // 'all' and 'registered' are equivalent: guests never reach Supabase

  const profiles = await supabaseSelect<{ id: string; plan: string }>(config, 'profiles', '?select=id,plan');
  const proUserIds = new Set(profiles.filter((p) => p.plan !== 'free').map((p) => p.id));
  return devices.filter((d) => proUserIds.has(d.user_id));
}

/**
 * Broadcast to a whole audience - MUST require explicit `confirm: true` to
 * prevent accidental spam (spec 2.4-D), and every send is audit-logged.
 */
export async function handleAdminPushAnnouncement(request: Request, env: Env, actor: string): Promise<Response> {
  const flags = (await getConfig(env)).featureFlags;
  const provider = getPushProvider(env);
  if (!flags.pushNotificationsEnabled || !provider.isConfigured) return pushDisabledResponse(env);

  const config = supabaseConfigFrom(env);
  if (!config) return notConfigured();

  const body = (await request.json().catch(() => null)) as { audience?: Audience; title?: string; body?: string; confirm?: boolean } | null;
  if (!body?.title || !body?.body || !body?.audience) throw new ApiError('INVALID_PARAMETER', 'audience, title and body are required');
  if (!['all', 'registered', 'pro'].includes(body.audience)) throw new ApiError('INVALID_PARAMETER', 'audience must be all, registered, or pro');
  if (!body.confirm) throw new ApiError('INVALID_PARAMETER', 'Set { "confirm": true } to send a mass push - this cannot be undone.');

  const devices = await devicesForAudience(config, body.audience);
  const results = await Promise.all(
    devices.map(async (device) => {
      const result = await provider.send({ token: device.fcm_token }, { title: body.title!, body: body.body! });
      await logNotification(env, {
        userId: device.user_id,
        alertId: null,
        deviceId: device.id,
        title: body.title!,
        body: body.body!,
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.error ?? null,
      });
      return result.success;
    }),
  );

  const sentCount = results.filter(Boolean).length;
  await recordAuditEntry(env, {
    actor,
    action: 'push.announcement_sent',
    target: body.audience,
    newValue: { targetCount: devices.length, sentCount },
  });

  return jsonResponse({ configured: true, targetCount: devices.length, sentCount });
}
