import { ApiError, jsonResponse } from '../errors';
import { AlpacaProvider } from '../providers/alpaca/alpaca-provider';
import { TwelveDataProvider } from '../providers/twelve-data/twelve-data-provider';
import { ProviderError } from '../providers/types';
import type { Env } from '../types';

/**
 * 2026-09-17 Catalog Expansion task - genuine, real verification of a
 * CANDIDATE catalog row before it is ever enabled in D1, using the actual
 * `TwelveDataProvider`/`AlpacaProvider` classes (never a mock/simulation,
 * never a fabricated result). Mirrors `admin-alpaca-capability-routes.ts`'s
 * proven pattern, generalized to accept an arbitrary candidate list
 * (this route's whole purpose is catalog expansion, not a fixed
 * representative set) and to test Twelve Data as well as Alpaca, since
 * this task also needs to confirm/correct Twelve Data symbol formats
 * (indices/commodities/Thai XBKK) that were never previously verified
 * live.
 *
 * Read-only in every sense that matters: real REST calls happen (real
 * provider usage, correctly recorded via each provider's own existing
 * quota choke point), but nothing is written to D1/KV and no routing
 * flag is touched - an operator (here: this task's own author) reviews
 * the results and decides which candidates to actually insert via the
 * existing `POST /api/mkr/admin/symbols` upsert route.
 *
 * Bounded and rate-aware by design, per the task's own "protect API
 * quota" instruction:
 * - a hard cap on candidates per call (never the whole universe at once)
 * - every request sequential, never concurrent (same reasoning as the
 *   Alpaca capability route - no confirmed-safe concurrency limit exists
 *   for either provider, so none is invented)
 * - the caller (this task's own execution) is responsible for pacing
 *   repeated calls across Twelve Data's real Basic-tier rate ceiling;
 *   this route does not loop indefinitely or retry on rate_limit itself
 */

const MAX_CANDIDATES_PER_CALL = 20;

interface DiscoveryCandidate {
  mkrSymbol: string;
  twelveDataSymbol?: string;
  alpacaSymbol?: string;
}

type CapabilityOutcome = 'works' | 'no_data' | 'capability' | 'auth' | 'rate_limit' | 'transient' | 'error' | 'not_configured';

interface ProviderOutcome {
  quote: CapabilityOutcome;
  quoteDetail?: string;
  candles: CapabilityOutcome;
  candlesDetail?: string;
}

interface CandidateResult {
  mkrSymbol: string;
  twelveData?: ProviderOutcome;
  alpaca?: ProviderOutcome;
}

/** Identical classification contract to admin-alpaca-capability-routes.ts's classifyFailure - provider-agnostic, since `ProviderError.kind` is already normalized identically by both TwelveDataProvider and AlpacaProvider. */
function classifyFailure(err: unknown): CapabilityOutcome {
  if (err instanceof ProviderError) {
    if (err.kind === 'auth') return 'auth';
    if (err.kind === 'rate_limit') return 'rate_limit';
    if (err.kind === 'not_found') return 'capability';
    if (err.kind === 'timeout' || err.kind === 'network') return 'transient';
  }
  return 'error';
}

async function verifyTwelveData(provider: TwelveDataProvider, providerSymbol: string, mkrSymbol: string): Promise<ProviderOutcome> {
  const result: ProviderOutcome = { quote: 'error', candles: 'error' };
  try {
    const quote = await provider.getQuote(providerSymbol, mkrSymbol);
    result.quote = quote ? 'works' : 'no_data';
  } catch (err) {
    result.quote = classifyFailure(err);
    result.quoteDetail = (err as Error).message;
  }
  try {
    const candles = await provider.getCandles(providerSymbol, mkrSymbol, 'd1', 5);
    result.candles = candles.length > 0 ? 'works' : 'no_data';
  } catch (err) {
    result.candles = classifyFailure(err);
    result.candlesDetail = (err as Error).message;
  }
  return result;
}

async function verifyAlpaca(provider: AlpacaProvider, providerSymbol: string, mkrSymbol: string): Promise<ProviderOutcome> {
  const result: ProviderOutcome = { quote: 'error', candles: 'error' };
  try {
    const quote = await provider.getQuote(providerSymbol, mkrSymbol);
    result.quote = quote ? 'works' : 'no_data';
  } catch (err) {
    result.quote = classifyFailure(err);
    result.quoteDetail = (err as Error).message;
  }
  try {
    const candles = await provider.getCandles(providerSymbol, mkrSymbol, 'd1', 5);
    result.candles = candles.length > 0 ? 'works' : 'no_data';
  } catch (err) {
    result.candles = classifyFailure(err);
    result.candlesDetail = (err as Error).message;
  }
  return result;
}

/**
 * 2026-09-17 Catalog Expansion task - a genuine reference-catalog lookup
 * (Twelve Data's `/stocks` endpoint, documented as reference/metadata
 * data - no quote/candle API credit consumed, so this is safe to call
 * without pacing against the 8-credits/minute Basic ceiling that gates
 * `handleAdminCatalogDiscoveryVerify`). Used specifically to discover the
 * EXACT Twelve Data symbol format for an exchange this deployment had no
 * prior confirmed mapping for (Thailand/XBKK) - guessing formats
 * (`SYMBOL:XBKK`, `SYMBOL.BK`, bare `SYMBOL`) against the real quote
 * endpoint burned real per-minute quota with no result; this asks Twelve
 * Data's own reference data directly instead.
 */
export async function handleAdminCatalogDiscoveryReference(request: Request, env: Env): Promise<Response> {
  if (!env.TWELVE_DATA_API_KEY) {
    return jsonResponse({ configured: false, message: 'TWELVE_DATA_API_KEY is not configured on this Worker.' });
  }
  const url = new URL(request.url);
  const exchange = url.searchParams.get('exchange');
  const symbol = url.searchParams.get('symbol');
  if (!exchange && !symbol) throw new ApiError('INVALID_PARAMETER', 'Provide at least one of: exchange, symbol');

  const params = new URLSearchParams({ apikey: env.TWELVE_DATA_API_KEY });
  if (exchange) params.set('exchange', exchange);
  if (symbol) params.set('symbol', symbol);

  let response: Response;
  try {
    response = await fetch(`https://api.twelvedata.com/stocks?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw new ApiError('PROVIDER_UNAVAILABLE', `Could not reach Twelve Data reference endpoint: ${(err as Error).message}`);
  }
  const json = (await response.json().catch(() => ({}))) as { data?: unknown[]; status?: string; message?: string };
  if (json.status === 'error') {
    // Never forward a raw provider message that could theoretically embed the key - defensive, matches the same discipline TwelveDataProvider's own request() already applies.
    const safeMessage = String(json.message ?? 'Twelve Data reference lookup failed').replace(/apikey=[^&\s"']+/gi, 'apikey=[redacted]');
    throw new ApiError('PROVIDER_UNAVAILABLE', safeMessage);
  }
  const rows = Array.isArray(json.data) ? json.data.slice(0, 50) : [];
  return jsonResponse({ count: rows.length, rows });
}

export async function handleAdminCatalogDiscoveryVerify(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { candidates?: unknown } | null;
  if (!body || !Array.isArray(body.candidates)) {
    throw new ApiError('INVALID_PARAMETER', 'Body must be { candidates: [{ mkrSymbol, twelveDataSymbol?, alpacaSymbol? }] }');
  }
  if (body.candidates.length === 0) {
    throw new ApiError('INVALID_PARAMETER', 'candidates must be a non-empty array');
  }
  if (body.candidates.length > MAX_CANDIDATES_PER_CALL) {
    throw new ApiError('INVALID_PARAMETER', `A maximum of ${MAX_CANDIDATES_PER_CALL} candidates may be verified per call - protects real provider quota. Call again for the next batch.`);
  }
  const candidates = body.candidates as DiscoveryCandidate[];
  for (const c of candidates) {
    if (typeof c.mkrSymbol !== 'string' || !c.mkrSymbol) throw new ApiError('INVALID_PARAMETER', 'Every candidate needs a non-empty mkrSymbol');
  }

  const twelveData = env.TWELVE_DATA_API_KEY ? new TwelveDataProvider(env.TWELVE_DATA_API_KEY) : null;
  const alpaca = env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY ? new AlpacaProvider(env.ALPACA_API_KEY_ID, env.ALPACA_API_SECRET_KEY) : null;

  const results: CandidateResult[] = [];
  for (const candidate of candidates) {
    const result: CandidateResult = { mkrSymbol: candidate.mkrSymbol };
    if (candidate.twelveDataSymbol) {
      result.twelveData = twelveData ? await verifyTwelveData(twelveData, candidate.twelveDataSymbol, candidate.mkrSymbol) : { quote: 'not_configured', candles: 'not_configured' };
    }
    if (candidate.alpacaSymbol) {
      result.alpaca = alpaca ? await verifyAlpaca(alpaca, candidate.alpacaSymbol, candidate.mkrSymbol) : { quote: 'not_configured', candles: 'not_configured' };
    }
    results.push(result);
  }

  return jsonResponse({
    testedAt: Date.now(),
    count: results.length,
    results,
    note: "Read-only verification - nothing was written to D1 or KV, no routing flag was touched. Insert only candidates whose relevant provider(s) show 'works' for both quote and candles via the existing POST /api/mkr/admin/symbols upsert route; anything else must stay excluded/disabled, never enabled on assumption.",
  });
}
