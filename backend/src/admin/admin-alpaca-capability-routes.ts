import { jsonResponse } from '../errors';
import { AlpacaProvider } from '../providers/alpaca/alpaca-provider';
import { isAlpacaCryptoSymbol } from '../providers/alpaca/alpaca-parser';
import { ProviderError } from '../providers/types';
import type { Env } from '../types';

/**
 * Hybrid Provider Architecture task (2026-09-16), item 4 - tests the
 * REAL, CURRENTLY-CONFIGURED Alpaca account against a small
 * representative symbol set, using the actual backend `AlpacaProvider`
 * class (never a mock/simulation). Read-only in every sense that matters:
 * it makes real Alpaca REST calls (consuming real API usage against the
 * account's own limits) but writes nothing to KV/D1, changes no config,
 * and never flips `hybridRoutingEnabled`/`hybridCryptoRoutingEnabled`/
 * `MARKET_SECONDARY_ENABLED` itself - an operator reviews the results and
 * makes that call themselves, per this task's own "do not enable public
 * provider routing based only on a successful API test" licensing/
 * display-rights guard (see the architecture report).
 *
 * Requests run SEQUENTIALLY, never concurrently - this codebase has no
 * documented, confirmed-safe Alpaca concurrency limit (only the task's
 * own reference to Alpaca's public docs: "Basic equity websocket
 * subscription limit is 30 symbols... Historical equity API... 200
 * calls/min on Basic" - REST call-rate headroom, not a concurrency
 * guarantee), so none is invented or assumed.
 */

const CAPABILITY_TEST_SYMBOLS: { mkrSymbol: string; alpacaSymbol: string }[] = [
  { mkrSymbol: 'AAPL', alpacaSymbol: 'AAPL' },
  { mkrSymbol: 'MSFT', alpacaSymbol: 'MSFT' },
  { mkrSymbol: 'NVDA', alpacaSymbol: 'NVDA' },
  { mkrSymbol: 'QQQ', alpacaSymbol: 'QQQ' },
  { mkrSymbol: 'TSLA', alpacaSymbol: 'TSLA' },
  // BTC/ETH/SOL/XRP - "if supported by current mapping" (task item 4): the
  // D1 catalog's own alpaca_symbol column already maps all four
  // (schema.sql) - included unconditionally here since that mapping
  // already exists. SOL/XRP added in the 2026-09-16 Alpaca Credential
  // E2E Test task - the full required 9-symbol set.
  { mkrSymbol: 'BTC', alpacaSymbol: 'BTC/USD' },
  { mkrSymbol: 'ETH', alpacaSymbol: 'ETH/USD' },
  { mkrSymbol: 'SOL', alpacaSymbol: 'SOL/USD' },
  { mkrSymbol: 'XRP', alpacaSymbol: 'XRP/USD' },
];

type CapabilityOutcome = 'works' | 'no_data' | 'capability' | 'auth' | 'rate_limit' | 'transient' | 'error';

interface SymbolCapabilityResult {
  mkrSymbol: string;
  alpacaSymbol: string;
  /**
   * Which Alpaca API family this symbol was actually routed through -
   * 'stock' (/v2/stocks) or 'crypto' (/v1beta3/crypto/us). Derived from
   * the same `isAlpacaCryptoSymbol` check AlpacaProvider itself uses
   * internally (2026-09-16 hybrid capability validation task) - reported
   * here, not hard-coded per test symbol, so this field is always exactly
   * what the provider actually did, never an assumption.
   */
  family: 'stock' | 'crypto';
  quote: CapabilityOutcome;
  quoteDetail?: string;
  candles: CapabilityOutcome;
  candlesDetail?: string;
}

/** Classifies a thrown fault into exactly the categories item 4 asks for - "whether failure is capability, authentication, rate limit, or transient." Never fabricates a category for an error kind it doesn't recognize (falls to the honest 'error' catch-all). */
function classifyFailure(err: unknown): CapabilityOutcome {
  if (err instanceof ProviderError) {
    if (err.kind === 'auth') return 'auth';
    if (err.kind === 'rate_limit') return 'rate_limit';
    if (err.kind === 'not_found') return 'capability'; // a permanent, symbol-specific "this account/plan can't serve this" outcome - see isSymbolSpecificError's doc comment in provider-manager.ts for the same distinction
    if (err.kind === 'timeout' || err.kind === 'network') return 'transient';
  }
  return 'error';
}

export async function handleAdminAlpacaCapabilityTest(_request: Request, env: Env): Promise<Response> {
  if (!env.ALPACA_API_KEY_ID || !env.ALPACA_API_SECRET_KEY) {
    // Task: "If the secrets are not yet configured... do NOT invent
    // values and do NOT block the whole architecture task... clearly
    // report the exact operator step needed to provision them." This IS
    // that exact step, surfaced at the one place an operator would
    // actually try to run the test.
    return jsonResponse({
      configured: false,
      message:
        'Alpaca credentials are not configured on this Worker. Provision both secrets, then re-run this test: `wrangler secret put ALPACA_API_KEY_ID` and `wrangler secret put ALPACA_API_SECRET_KEY` (values from the Alpaca Paper account dashboard - never commit or log them).',
    });
  }

  const provider = new AlpacaProvider(env.ALPACA_API_KEY_ID, env.ALPACA_API_SECRET_KEY);
  const results: SymbolCapabilityResult[] = [];

  for (const { mkrSymbol, alpacaSymbol } of CAPABILITY_TEST_SYMBOLS) {
    const result: SymbolCapabilityResult = { mkrSymbol, alpacaSymbol, family: isAlpacaCryptoSymbol(alpacaSymbol) ? 'crypto' : 'stock', quote: 'error', candles: 'error' };

    try {
      const quote = await provider.getQuote(alpacaSymbol, mkrSymbol);
      result.quote = quote ? 'works' : 'no_data';
    } catch (err) {
      result.quote = classifyFailure(err);
      result.quoteDetail = (err as Error).message;
    }

    try {
      const candles = await provider.getCandles(alpacaSymbol, mkrSymbol, 'd1', 5);
      result.candles = candles.length > 0 ? 'works' : 'no_data';
    } catch (err) {
      result.candles = classifyFailure(err);
      result.candlesDetail = (err as Error).message;
    }

    results.push(result);
  }

  // A single, separate health probe (item 4: "returned source... whether
  // failure is capability, authentication, rate limit, or transient" -
  // healthCheck() itself is the cheapest, most direct signal for the
  // "is the account/connection fundamentally reachable at all" question).
  const health = await provider.healthCheck();

  return jsonResponse({
    configured: true,
    testedAt: Date.now(),
    healthCheck: health,
    results,
    note: "Read-only capability test - no routing flags were changed by running this. Review these results, then set HYBRID_ROUTING_ENABLED / HYBRID_CRYPTO_ROUTING_ENABLED (and MARKET_SECONDARY_ENABLED) yourself once satisfied - see the architecture report's licensing/display-rights gate before enabling public routing.",
  });
}
