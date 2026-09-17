import { getConfig, updateConfig } from '../config/config-service';
import { isValidDailyBudget, isValidRateLimit, isValidTtlSeconds } from '../config/defaults';
import { managerFor } from '../market/provider-manager-factory';
import { ApiError, jsonResponse } from '../errors';
import { budgetSnapshot } from '../providers/quota-manager';
import { catalogFor } from '../symbols/symbol-catalog';
import type { Env, ProviderId } from '../types';
import { createSessionToken, verifyPassword } from './auth';
import { listAuditLog, recordAuditEntry } from './audit-log';
import type { SymbolRow } from '../symbols/symbol-catalog';

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
  // 2026-09-17 Pre-Closed-Testing Final task - real audit gap found: a
  // request that changes ONLY `secondaryProvider` (e.g. alpaca ->
  // twelve_data) while `secondaryEnabled` stays the same previously wrote
  // zero audit rows, even though the config value on disk changed. This
  // was found while investigating why a prior pass's hybrid-flag drift
  // could not be traced - not itself the cause of that specific incident
  // (see `defaults.ts`'s env-var fallback, a separate gap this task's own
  // report documents), but a real, independently-fixable hole in the same
  // "every runtime-config write must be traceable" contract.
  if (before.secondaryProvider !== after.secondaryProvider) {
    await recordAuditEntry(env, { actor, action: 'provider.secondary_provider.changed', oldValue: before.secondaryProvider, newValue: after.secondaryProvider });
  }
  if (before.primaryProvider !== after.primaryProvider) {
    await recordAuditEntry(env, { actor, action: 'provider.primary.changed', oldValue: before.primaryProvider, newValue: after.primaryProvider });
  }
  if (JSON.stringify(before.providerBudgets) !== JSON.stringify(after.providerBudgets)) {
    await recordAuditEntry(env, { actor, action: 'provider.budgets.changed', oldValue: before.providerBudgets, newValue: after.providerBudgets });
  }
  return jsonResponse(after);
}

/**
 * 2026-09-17 Catalog Expansion task - the catalog is materially larger now
 * (see schema.sql), so Admin Web needs to filter/search it rather than
 * always rendering every row. Filtering happens in-memory over the
 * already-fetched full row set (no new SQL path, no added D1 query
 * surface) - the catalog is still small enough (low hundreds of rows at
 * most, per this task's own "largest PRACTICAL, not the whole provider
 * universe" instruction) that this costs nothing meaningful, and it keeps
 * `SymbolCatalog` itself unchanged/lower-risk. Never triggers any provider
 * request - this is exactly the same D1 read `handleAdminSymbolsGet`
 * already did, just filtered before the response is built.
 */
/**
 * 2026-09-17 Final UX/Reliability task - "STANDBY" here means exactly what
 * the catalog-expansion pass left behind: a row with a real, previously
 * verified provider mapping that is disabled only because activating its
 * sole capable provider (Alpaca) is a separate, not-yet-made production
 * decision - never a placeholder and never a fabricated mapping. "DEAD"
 * means disabled with no working mapping at all (the legacy
 * SPX/NDX/.../SET50 rows). This distinction already existed implicitly in
 * the data (`enabled` + whether a mapping column is populated); it was
 * just never surfaced to Admin Web, which could only see a flat
 * enabled/disabled boolean and had no way to tell "verified, standing by"
 * apart from "verified dead, do not re-enable this."
 */
type SymbolStatus = 'enabled' | 'standby' | 'dead';
type ProviderCoverage = 'twelve_data' | 'alpaca' | 'both' | 'none';

function statusFor(row: SymbolRow): SymbolStatus {
  if (row.enabled !== 0) return 'enabled';
  return row.twelve_data_symbol || row.alpaca_symbol ? 'standby' : 'dead';
}

function coverageFor(row: SymbolRow): ProviderCoverage {
  const hasTd = !!row.twelve_data_symbol;
  const hasAlpaca = !!row.alpaca_symbol;
  if (hasTd && hasAlpaca) return 'both';
  if (hasTd) return 'twelve_data';
  if (hasAlpaca) return 'alpaca';
  return 'none';
}

function withStatus(row: SymbolRow) {
  return { ...row, status: statusFor(row), providerCoverage: coverageFor(row) };
}

export async function handleAdminSymbolsGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const search = url.searchParams.get('search')?.trim().toLowerCase();
  const enabledOnly = url.searchParams.get('enabledOnly') === 'true';
  const status = url.searchParams.get('status') as SymbolStatus | null;

  let rows = await catalogFor(env).all();
  if (category) rows = rows.filter((r) => r.category === category);
  if (enabledOnly) rows = rows.filter((r) => r.enabled !== 0);
  if (search) rows = rows.filter((r) => r.symbol.toLowerCase().includes(search) || r.display_name.toLowerCase().includes(search));

  let withComputed = rows.map(withStatus);
  if (status && (status === 'enabled' || status === 'standby' || status === 'dead')) {
    withComputed = withComputed.filter((r) => r.status === status);
  }

  return jsonResponse(withComputed);
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

/**
 * 2026-09-17 Catalog Expansion task - "safe bulk enable/disable only if
 * already structurally safe" (task's own words). This is: each patch is
 * routed through the exact same single-row `upsert` the individual-symbol
 * route already used (no new SQL, no new validation path), applied
 * sequentially to a bounded batch, and NEVER creates a row that doesn't
 * already exist (a bulk call is for managing what's there, not for mass
 * catalog import - that stays the discovery-verify + individual-upsert
 * flow). No provider request of any kind - patches only enabled/featured/
 * sortOrder, the three fields that were the actual pain point of managing
 * a much bigger catalog one row at a time.
 */
export async function handleAdminSymbolsBulkUpdate(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    patches?: { symbol?: string; enabled?: boolean; featured?: boolean; sortOrder?: number }[];
  } | null;
  if (!body || !Array.isArray(body.patches) || body.patches.length === 0) {
    throw new ApiError('INVALID_PARAMETER', 'Body must be { patches: [{ symbol, enabled?, featured?, sortOrder? }] }');
  }
  if (body.patches.length > 100) {
    throw new ApiError('INVALID_PARAMETER', 'A maximum of 100 patches may be applied per call');
  }

  const catalog = catalogFor(env);
  const results: { symbol: string; updated: boolean; reason?: string }[] = [];
  for (const patch of body.patches) {
    if (!patch.symbol) {
      results.push({ symbol: '(missing)', updated: false, reason: 'symbol is required' });
      continue;
    }
    const before = await catalog.get(patch.symbol);
    if (!before) {
      // Never creates a row - see the function's own doc comment.
      results.push({ symbol: patch.symbol, updated: false, reason: 'symbol does not exist - bulk update never creates new rows' });
      continue;
    }
    await catalog.upsert({
      symbol: before.symbol,
      display_name: before.display_name,
      category: before.category,
      enabled: (patch.enabled ?? before.enabled === 1) ? 1 : 0,
      featured: (patch.featured ?? before.featured === 1) ? 1 : 0,
      sort_order: patch.sortOrder ?? before.sort_order,
      twelve_data_symbol: before.twelve_data_symbol,
      alpaca_symbol: before.alpaca_symbol,
      default_timeframe: before.default_timeframe,
      cache_ttl_seconds: before.cache_ttl_seconds,
    });
    results.push({ symbol: patch.symbol, updated: true });
  }

  await recordAuditEntry(env, { actor, action: 'symbol.bulk_updated', target: `${results.filter((r) => r.updated).length}/${results.length}`, oldValue: null, newValue: null });

  return jsonResponse({ results });
}

/**
 * 2026-09-17 Final UX/Reliability task - `listAuditLog`/`recordAuditEntry`
 * have existed since the very first admin route, and every runtime-config
 * change this session has made (provider/feature-flag toggles, symbol
 * upserts) has been dutifully recorded - but nothing ever exposed a route
 * to READ it back. The prior catalog-expansion pass hit this gap directly:
 * `secondaryEnabled`/`hybridRoutingEnabled`/`hybridCryptoRoutingEnabled`
 * were found live `true` with no way to determine who or what set them,
 * since there was no way to query the log that should have recorded it.
 * `recordAuditEntry`'s own `assertSafeToLog` already refuses to persist
 * anything that looks like a secret at write time, so reading these rows
 * back is safe by construction - no separate redaction needed here.
 */
export async function handleAdminAuditLog(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 100;
  return jsonResponse(await listAuditLog(env, limit));
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
