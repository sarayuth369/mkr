import { getConfig, updateConfig } from '../config/config-service';
import { isValidDailyBudget, isValidRateLimit, isValidTtlSeconds } from '../config/defaults';
import { managerFor } from '../market/provider-manager-factory';
import { ApiError, jsonResponse } from '../errors';
import { budgetSnapshot } from '../providers/quota-manager';
import { catalogFor } from '../symbols/symbol-catalog';
import type { Env, ProviderId } from '../types';
import { createSessionToken, verifyPassword } from './auth';
import { listAuditLog, recordAuditEntry } from './audit-log';

// Task 6: this used to be a second, local copy of provider-manager-factory.ts's
// managerFor - a real "alternate route" that bypassed whatever the shared
// factory does (now including the quota guard). Replaced with the shared
// one so admin routes are gated by the same budget guard as everything
// else, with no second construction path left to drift out of sync.

export async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    throw new ApiError('ADMIN_FORBIDDEN', 'Admin authentication is not configured on this deployment.');
  }
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || !verifyPassword(body.password, env.ADMIN_PASSWORD)) {
    throw new ApiError('AUTH_REQUIRED', 'Incorrect password.');
  }
  const session = await createSessionToken(env.ADMIN_SESSION_SECRET);
  return jsonResponse(session);
}

export async function handleAdminDashboard(_request: Request, env: Env): Promise<Response> {
  const config = await getConfig(env);
  const manager = await managerFor(env, config);
  const health = await manager.healthSnapshot();
  const symbols = await catalogFor(env).all();
  return jsonResponse({
    config,
    providerHealth: health,
    symbolCount: symbols.length,
    enabledSymbolCount: symbols.filter((s) => s.enabled === 1).length,
    timestamp: Date.now(),
  });
}

export async function handleAdminProvidersGet(_request: Request, env: Env): Promise<Response> {
  const config = await getConfig(env);
  const manager = await managerFor(env, config);
  const health = await manager.healthSnapshot();
  return jsonResponse({
    primaryProvider: config.primaryProvider,
    secondaryProvider: config.secondaryProvider,
    secondaryEnabled: config.secondaryEnabled,
    configured: {
      twelve_data: !!env.TWELVE_DATA_API_KEY,
      alpaca: !!(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY),
    },
    health,
    // Task 6 - read-only snapshot of the quota guard's current state per
    // provider (tier/usedFraction/budget). `budget: null` means
    // unconfigured (guard inactive) - never a fabricated number.
    budgets: {
      twelve_data: budgetSnapshot('twelve_data', config.providerBudgets.twelveData),
      alpaca: budgetSnapshot('alpaca', config.providerBudgets.alpaca),
    },
  });
}

export async function handleAdminProvidersUpdate(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Partial<{
    primaryProvider: ProviderId;
    secondaryProvider: ProviderId | null;
    secondaryEnabled: boolean;
    providerBudgets: Partial<{ twelveData: { dailyRequestBudget: number }; alpaca: { dailyRequestBudget: number } }>;
  }>;

  const before = await getConfig(env);
  if (body.secondaryEnabled === true && body.secondaryProvider === 'alpaca' && !(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY)) {
    throw new ApiError('INVALID_PARAMETER', 'Cannot enable Alpaca: ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY secrets are not configured.');
  }

  const budgetPatch = { ...before.providerBudgets };
  if (body.providerBudgets?.twelveData !== undefined) {
    if (!isValidDailyBudget(body.providerBudgets.twelveData.dailyRequestBudget)) {
      throw new ApiError('INVALID_PARAMETER', 'providerBudgets.twelveData.dailyRequestBudget must be >= 0');
    }
    budgetPatch.twelveData = body.providerBudgets.twelveData;
  }
  if (body.providerBudgets?.alpaca !== undefined) {
    if (!isValidDailyBudget(body.providerBudgets.alpaca.dailyRequestBudget)) {
      throw new ApiError('INVALID_PARAMETER', 'providerBudgets.alpaca.dailyRequestBudget must be >= 0');
    }
    budgetPatch.alpaca = body.providerBudgets.alpaca;
  }

  const after = await updateConfig(env, {
    primaryProvider: body.primaryProvider ?? before.primaryProvider,
    secondaryProvider: body.secondaryProvider ?? before.secondaryProvider,
    secondaryEnabled: body.secondaryEnabled ?? before.secondaryEnabled,
    providerBudgets: budgetPatch,
  });

  if (before.secondaryEnabled !== after.secondaryEnabled) {
    await recordAuditEntry(env, {
      actor,
      action: 'provider.secondary_enabled.changed',
      target: after.secondaryProvider ?? undefined,
      oldValue: before.secondaryEnabled,
      newValue: after.secondaryEnabled,
    });
  }
  if (before.primaryProvider !== after.primaryProvider) {
    await recordAuditEntry(env, { actor, action: 'provider.primary.changed', oldValue: before.primaryProvider, newValue: after.primaryProvider });
  }
  if (JSON.stringify(before.providerBudgets) !== JSON.stringify(after.providerBudgets)) {
    await recordAuditEntry(env, { actor, action: 'provider.budgets.changed', oldValue: before.providerBudgets, newValue: after.providerBudgets });
  }
  return jsonResponse(after);
}

export async function handleAdminSymbolsGet(_request: Request, env: Env): Promise<Response> {
  return jsonResponse(await catalogFor(env).all());
}

export async function handleAdminSymbolsUpdate(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    symbol?: string;
    displayName?: string;
    category?: string;
    enabled?: boolean;
    featured?: boolean;
    sortOrder?: number;
    twelveDataSymbol?: string | null;
    alpacaSymbol?: string | null;
    defaultTimeframe?: string;
    cacheTtlSeconds?: number | null;
  } | null;
  if (!body?.symbol) throw new ApiError('INVALID_PARAMETER', 'symbol is required');

  const catalog = catalogFor(env);
  const before = await catalog.get(body.symbol);
  await catalog.upsert({
    symbol: body.symbol,
    display_name: body.displayName ?? before?.display_name ?? body.symbol,
    category: body.category ?? before?.category ?? 'other',
    enabled: (body.enabled ?? (before ? before.enabled === 1 : true)) ? 1 : 0,
    featured: (body.featured ?? (before ? before.featured === 1 : false)) ? 1 : 0,
    sort_order: body.sortOrder ?? before?.sort_order ?? 999,
    twelve_data_symbol: body.twelveDataSymbol !== undefined ? body.twelveDataSymbol : (before?.twelve_data_symbol ?? null),
    alpaca_symbol: body.alpacaSymbol !== undefined ? body.alpacaSymbol : (before?.alpaca_symbol ?? null),
    default_timeframe: body.defaultTimeframe ?? before?.default_timeframe ?? 'd1',
    cache_ttl_seconds: body.cacheTtlSeconds !== undefined ? body.cacheTtlSeconds : (before?.cache_ttl_seconds ?? null),
  });

  await recordAuditEntry(env, {
    actor,
    action: before ? 'symbol.updated' : 'symbol.created',
    target: body.symbol,
    oldValue: before ? { enabled: before.enabled === 1 } : null,
    newValue: { enabled: body.enabled ?? true },
  });

  return jsonResponse(await catalog.get(body.symbol));
}

export async function handleAdminCacheGet(_request: Request, env: Env): Promise<Response> {
  return jsonResponse((await getConfig(env)).cacheTtls);
}

export async function handleAdminCacheUpdate(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const before = (await getConfig(env)).cacheTtls;
  const patch: Partial<typeof before> = {};

  for (const key of ['quoteSeconds', 'candleIntradaySeconds', 'candleDailySeconds', 'statusSeconds', 'staleThresholdSeconds'] as const) {
    if (body[key] !== undefined) {
      if (!isValidTtlSeconds(body[key])) throw new ApiError('INVALID_PARAMETER', `${key} must be between 1 and 86400 seconds`);
      patch[key] = body[key] as number;
    }
  }

  const after = await updateConfig(env, { cacheTtls: { ...before, ...patch } });
  await recordAuditEntry(env, { actor, action: 'cache.ttl.changed', oldValue: before, newValue: after.cacheTtls });
  return jsonResponse(after.cacheTtls);
}

export async function handleAdminRateLimitsGet(_request: Request, env: Env): Promise<Response> {
  return jsonResponse((await getConfig(env)).rateLimits);
}

export async function handleAdminRateLimitsUpdate(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> & { confirm?: boolean };
  const before = (await getConfig(env)).rateLimits;
  const patch: Partial<typeof before> = {};

  for (const key of ['publicPerMinute', 'adminPerMinute', 'wsMaxConnections'] as const) {
    if (body[key] !== undefined) {
      if (!isValidRateLimit(body[key])) throw new ApiError('INVALID_PARAMETER', `${key} must be between 1 and 100000`);
      if ((body[key] as number) > 10_000 && !body.confirm) {
        throw new ApiError('INVALID_PARAMETER', `${key} above 10000 requires { "confirm": true } to avoid accidentally disabling protection`);
      }
      patch[key] = body[key] as number;
    }
  }

  const after = await updateConfig(env, { rateLimits: { ...before, ...patch } });
  await recordAuditEntry(env, { actor, action: 'ratelimit.changed', oldValue: before, newValue: after.rateLimits });
  return jsonResponse(after.rateLimits);
}

export async function handleAdminFeaturesGet(_request: Request, env: Env): Promise<Response> {
  return jsonResponse((await getConfig(env)).featureFlags);
}

export async function handleAdminFeaturesUpdate(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const before = (await getConfig(env)).featureFlags;
  const patch: Partial<typeof before> = {};
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean;
  }
  const after = await updateConfig(env, { featureFlags: { ...before, ...patch } });
  await recordAuditEntry(env, { actor, action: 'features.changed', oldValue: before, newValue: after.featureFlags });
  return jsonResponse(after.featureFlags);
}

export async function handleAdminHealth(_request: Request, env: Env): Promise<Response> {
  const config = await getConfig(env);
  const manager = await managerFor(env, config);
  const health = await manager.healthSnapshot();
  let d1Ok = true;
  try {
    await env.MKR_DB.prepare('SELECT 1').first();
  } catch {
    d1Ok = false;
  }
  let kvOk = true;
  try {
    await env.MKR_CONFIG.get('runtime-config');
  } catch {
    kvOk = false;
  }
  return jsonResponse({ providers: health, storage: { d1: d1Ok, kv: kvOk }, timestamp: Date.now() });
}

export async function handleAdminLogs(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 100;
  return jsonResponse(await listAuditLog(env, limit));
}

export async function handleAdminSettings(_request: Request, env: Env): Promise<Response> {
  const config = await getConfig(env);
  return jsonResponse({
    config,
    secrets: {
      twelveDataApiKey: env.TWELVE_DATA_API_KEY ? 'configured' : 'not_configured',
      alpacaCredentials: env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY ? 'configured' : 'not_configured',
      adminPassword: env.ADMIN_PASSWORD ? 'configured' : 'not_configured',
      adminSessionSecret: env.ADMIN_SESSION_SECRET ? 'configured' : 'not_configured',
      supabase: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'configured' : 'not_configured',
      fcm: env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY ? 'configured' : 'not_configured',
    },
  });
}
