import type { Env } from '../types';
import { defaultConfig, type RuntimeConfig } from './defaults';

const CONFIG_KEY = 'runtime-config';

/**
 * KV-backed runtime configuration - what Admin Web edits. Falls back to
 * [defaultConfig] (derived from `wrangler.toml` `[vars]`) when KV has
 * nothing yet, so a fresh deploy with no Admin changes behaves exactly like
 * the non-secret defaults committed to source control.
 */
export async function getConfig(env: Env): Promise<RuntimeConfig> {
  const stored = await env.MKR_CONFIG.get<RuntimeConfig>(CONFIG_KEY, 'json');
  const fallback = defaultConfig(env);
  if (!stored) return fallback;
  // Shallow-merge nested objects so adding a new field to defaultConfig
  // later doesn't require every existing KV document to be rewritten.
  return {
    ...fallback,
    ...stored,
    cacheTtls: { ...fallback.cacheTtls, ...stored.cacheTtls },
    rateLimits: { ...fallback.rateLimits, ...stored.rateLimits },
    featureFlags: { ...fallback.featureFlags, ...stored.featureFlags },
  };
}

export async function setConfig(env: Env, config: RuntimeConfig): Promise<void> {
  await env.MKR_CONFIG.put(CONFIG_KEY, JSON.stringify(config));
}

export async function updateConfig(env: Env, patch: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
  const current = await getConfig(env);
  const next: RuntimeConfig = {
    ...current,
    ...patch,
    cacheTtls: { ...current.cacheTtls, ...patch.cacheTtls },
    rateLimits: { ...current.rateLimits, ...patch.rateLimits },
    featureFlags: { ...current.featureFlags, ...patch.featureFlags },
  };
  await setConfig(env, next);
  return next;
}
