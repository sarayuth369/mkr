import type { ProviderId } from '../types';

/**
 * Provider capability model — Hybrid Provider Architecture task
 * (2026-09-16).
 *
 * Deliberately separates three concerns that were previously conflated
 * into one boolean (`secondaryEnabled`):
 * 1. CAPABILITY — can this provider technically serve this symbol at all?
 *    See [hasAlpacaMapping] below — sourced from the D1 `symbols` table's
 *    existing `twelve_data_symbol`/`alpaca_symbol` columns (already
 *    populated correctly: only `us_stock`/`crypto` rows carry a non-null
 *    `alpaca_symbol` in schema.sql's seed data today) — never a
 *    hard-coded symbol list, per the task's own instruction to prefer the
 *    existing D1 mapping over one.
 * 2. ROUTING PREFERENCE — given a symbol IS capable, which provider
 *    should be tried FIRST? See [resolvePreferredProvider].
 * 3. ACTIVATION — is Alpaca allowed to be contacted at all, and is hybrid
 *    routing turned on? These remain `MarketProviderManager`'s own
 *    `secondaryEnabled` (unchanged, pre-existing) and the two new feature
 *    flags below — this module has no opinion on activation, it only
 *    answers capability/preference GIVEN that activation has already been
 *    decided elsewhere (config-service.ts / provider-manager.ts).
 *
 * Sourced from Alpaca's own public documentation as referenced by the
 * task (current as of 2026-09 — re-verify against Alpaca's docs before
 * trusting this long-term, the same caution this file's own comments
 * apply to Twelve Data elsewhere in this codebase):
 * - Basic market data tier is free; US equities realtime on Basic is
 *   IEX-sourced (not the full consolidated tape).
 * - Covers Stocks, ETFs, Options, Crypto and News market data.
 * - Does NOT cover FX, Gold/commodities, or global (non-US) indices —
 *   MKR's D1 catalog already reflects this (no `alpaca_symbol` on any
 *   `forex`/`gold`/`indices`/`thailand`/`commodity`/`rate` row), so no
 *   separate asset-class table is needed here for those categories.
 */
export interface HybridRoutingFlags {
  /** Master switch — when `false`, [resolvePreferredProvider] always returns `null` (Twelve Data stays first for everything), regardless of mapping. */
  hybridRoutingEnabled: boolean;
  /**
   * Crypto gets its OWN, more conservative switch — the task is explicit
   * that crypto capability must be confirmed by an actual provider test,
   * never inferred from the asset-class name alone (unlike `us_stock`,
   * whose Alpaca/IEX capability is well-documented and stable enough to
   * trust from mapping presence + the master switch alone). An operator
   * flips this only after reviewing real capability-test results (see
   * `capability-test.ts`).
   */
  hybridCryptoRoutingEnabled: boolean;
}

/**
 * Hard capability gate for the batch/quote/candle REST operations — does
 * NOT cover streaming (see [canStream] below, a separate and currently
 * always-`false`-for-Alpaca dimension). `false` means this provider must
 * NEVER be asked for this symbol, regardless of any routing preference or
 * feature flag; `true` means it's technically possible, not that it's
 * currently preferred or that public traffic is enabled for it.
 */
export function providerCanServe(hasProviderMapping: boolean): boolean {
  return hasProviderMapping; // the D1 mapping IS the capability signal - see class doc comment.
}

/**
 * 2026-09-16 Hybrid Provider Architecture task: streaming is modeled here
 * as a real, distinct capability dimension (the task explicitly asks
 * "can provider stream it?" as its own question), but `MarketStreamRoom`
 * (the Market Pool's single canonical upstream — see market-stream-do.ts)
 * is not wired to open a second (Alpaca) WebSocket connection type in
 * this pass — a deliberate, separately-gated scope boundary documented in
 * this task's architecture report, not an oversight. Reporting Alpaca
 * streaming as unavailable here is honest given the code's actual current
 * capability, never a fabricated limitation. Twelve Data streaming is
 * unaffected (unchanged, still the pool's sole upstream).
 */
export function canStream(provider: ProviderId, hasProviderMapping: boolean): boolean {
  if (provider === 'alpaca') return false;
  return hasProviderMapping;
}

/**
 * Which provider should be tried FIRST for this symbol's quote/candle
 * requests — `null` means "leave Twelve Data first" (the pre-hybrid,
 * always-safe default), matching `MarketProviderManager`'s existing
 * primary/secondary failover order exactly when hybrid routing is off or
 * doesn't apply to this symbol. This function has NO opinion on whether
 * Alpaca may be contacted at all — `MarketProviderManager` re-checks its
 * own `secondaryEnabled` regardless of what this returns (defense in
 * depth: a caller that accidentally passes a stale/wrong preference can
 * never cause Alpaca to be contacted when it's globally disabled).
 */
export function resolvePreferredProvider(category: string, hasAlpacaMapping: boolean, flags: HybridRoutingFlags): ProviderId | null {
  if (!hasAlpacaMapping) return null; // D1 itself has no Alpaca symbol for this row - never guess one
  if (!flags.hybridRoutingEnabled) return null; // master switch off
  if (category === 'crypto') return flags.hybridCryptoRoutingEnabled ? 'alpaca' : null; // its own, separately-gated switch - see HybridRoutingFlags doc comment
  if (category === 'us_stock') return 'alpaca'; // well-documented Alpaca Basic/IEX capability
  return null; // forex/gold/indices/thailand/etc. - Alpaca has no mapping anyway (providerCanServe would already say so), explicit here for clarity/future categories
}
