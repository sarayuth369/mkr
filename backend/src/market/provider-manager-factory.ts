import { getConfig } from '../config/config-service';
import { MarketProviderManager } from '../providers/provider-manager';
import { buildProvider } from '../providers/provider-registry';
import type { Env } from '../types';

/**
 * Single construction point for [MarketProviderManager] - extracted from
 * market-routes.ts so market-stream-do.ts's candle historical-reconciliation
 * path (Decision 8) can reuse the exact same provider abstraction/failover
 * engine instead of a second one (explicitly forbidden: "ห้ามสร้าง...second
 * market provider manager").
 */
export async function managerFor(env: Env, config: Awaited<ReturnType<typeof getConfig>>): Promise<MarketProviderManager> {
  const primary = buildProvider(config.primaryProvider, env);
  const secondary = config.secondaryProvider ? buildProvider(config.secondaryProvider, env) : null;
  return new MarketProviderManager(primary, secondary, config.secondaryEnabled);
}
