import { cachedFetch, cacheKey, getCached } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import { logError, logInfo } from '../logging';
import { requireSymbolRow } from '../market/market-routes';
import { managerFor } from '../market/provider-manager-factory';
import { resolvePreferredProvider } from '../providers/capability';
import { mapSymbolFromRows } from '../symbols/symbol-mapper';
import type { Env, NormalizedQuote, ProviderId } from '../types';

/** Matches lib/features/ai/domain/ai_insight.dart's AIInsight exactly. */
interface AiInsightPayload {
  summary: string;
  whyItMatters: string;
  marketImpact: string;
  whatToWatch: string[];
  risks: string[];
  generatedAt: number;
}

/**
 * Applies to every AI call in this file - matches the safety contract
 * already documented on MarketAIService (lib/features/ai/domain/market_ai_service.dart):
 * descriptive analysis/education/risk context only, never a direct
 * buy/sell instruction or a guaranteed prediction.
 */
const SAFETY_SYSTEM_PROMPT = `You are the MKR (Market Radar) AI assistant, a descriptive financial market analysis assistant embedded in a market-tracking app.
Rules you must always follow, without exception:
- Never give a direct buy/sell/trade instruction (e.g. "buy X", "sell Y", "you should invest in Z").
- Never present a future-looking statement as guaranteed or certain - always frame it as a possibility, not a fact.
- Be concise and grounded only in the data given to you in this conversation - never invent a specific price, date, or event that was not provided to you.
- Always surface at least one relevant risk or uncertainty when discussing market direction.
- This is general market information for educational purposes only, never personalized financial advice, and you must never claim otherwise.`;

const STRUCTURED_INSTRUCTION = `Respond with ONLY a single JSON object and nothing else - no markdown fences, no explanation before or after. It must match exactly this shape:
{"summary": string, "whyItMatters": string, "marketImpact": string, "whatToWatch": string[], "risks": string[]}
"summary" is 1-2 sentences. "whyItMatters" and "marketImpact" are each 1-3 sentences. "whatToWatch" and "risks" are each 2-4 short bullet-point strings.`;

function aiDisabled(): never {
  throw new ApiError('FEATURE_DISABLED', 'AI features are not enabled on this deployment.');
}

async function requireAiEnabled(env: Env): Promise<void> {
  const { featureFlags } = await getConfig(env);
  if (!featureFlags.aiBriefEnabled) aiDisabled();
}

/** Logs the raw model text (truncated - never unbounded, this is
 * diagnostic-only) whenever parsing fails, so a bad response is actually
 * debuggable server-side instead of only ever showing up as an opaque
 * INTERNAL_ERROR client-side - confirmed necessary live (2026-09-15): the
 * very first parse failure after switching models had no raw text logged
 * anywhere, and had to be re-diagnosed by hand. */
function logParseFailure(reason: string, text: string, route: string): void {
  logError(reason, { route, rawResponse: text.slice(0, 500) });
}

function extractJsonObject(text: string, route: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    logParseFailure('AI response contained no JSON object', text, route);
    throw new ApiError('INTERNAL_ERROR', 'AI response was not valid JSON.');
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    logParseFailure('AI response JSON failed to parse', text, route);
    throw new ApiError('INTERNAL_ERROR', 'AI response was not valid JSON.');
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseInsight(text: string, route: string): AiInsightPayload {
  const parsed = extractJsonObject(text, route) as Record<string, unknown>;
  const summary = parsed.summary;
  const whyItMatters = parsed.whyItMatters;
  const marketImpact = parsed.marketImpact;
  if (typeof summary !== 'string' || typeof whyItMatters !== 'string' || typeof marketImpact !== 'string') {
    logParseFailure('AI response JSON was missing required fields', text, route);
    throw new ApiError('INTERNAL_ERROR', 'AI response was missing required fields.');
  }
  return {
    summary,
    whyItMatters,
    marketImpact,
    whatToWatch: toStringArray(parsed.whatToWatch),
    risks: toStringArray(parsed.risks),
    generatedAt: Date.now(),
  };
}

/** Cloudflare Workers AI text-generation model - no external account/key
 * required. `@cf/meta/llama-3.1-8b-instruct` (the original choice here)
 * was deprecated by Cloudflare on 2026-05-30 - confirmed live
 * (2026-09-15, via wrangler tail) once every AI route started failing
 * with "PROVIDER_UNAVAILABLE" right after the feature flag was turned on;
 * the actual env.AI.run() error named the deprecation explicitly. Verified
 * against Cloudflare's current model catalog before picking this
 * replacement (developers.cloudflare.com/workers-ai/models/) rather than
 * guessing an ID. */
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;

/**
 * Workers AI's `response` field is normally a plain string, but a few
 * models (confirmed live 2026-09-15 with llama-3.3-70b-instruct-fp8-fast,
 * after the previous model was deprecated) return something else in some
 * cases - a nested object, or an OpenAI-compatible `choices[0].message.content`
 * shape. Checks each documented shape before giving up; logs the actual
 * raw structure (truncated) only when none match, so a future model
 * swap's response shape is debuggable from one log line instead of
 * needing another live round-trip to diagnose by hand.
 */
function extractModelText(raw: unknown, route: string): string {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.response === 'string') return obj.response;
    if (obj.response && typeof obj.response === 'object') {
      const nested = obj.response as Record<string, unknown>;
      if (typeof nested.content === 'string') return nested.content;
      if (typeof nested.text === 'string') return nested.text;
    }
    if (Array.isArray(obj.choices)) {
      const first = obj.choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      if (typeof message?.content === 'string') return message.content;
    }
  }
  logError('AI response had no recognizable text field', { route, rawShape: JSON.stringify(raw).slice(0, 500) });
  return '';
}

async function runInsight(env: Env, requestId: string, route: string, userPrompt: string): Promise<AiInsightPayload> {
  let raw: unknown;
  try {
    raw = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: `${SAFETY_SYSTEM_PROMPT}\n\n${STRUCTURED_INSTRUCTION}` },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 700,
    });
  } catch (err) {
    logError('AI run failed', { requestId, route, message: (err as Error).message });
    throw new ApiError('PROVIDER_UNAVAILABLE', 'AI provider request failed.');
  }
  return parseInsight(extractModelText(raw, route), route);
}

/** Passive KV read only - never fetches. Kept for [handleAiBrief], which
 * deliberately avoids forcing a fresh provider fetch for a 5-symbol
 * grounding list on every Home render (that would add a real request
 * burst for a card the task's own reliability pass explicitly forbids
 * increasing). A cold cache here just means thinner grounding, never
 * fabricated numbers. */
async function cachedQuoteContext(env: Env, symbols: string[]): Promise<string> {
  const lines: string[] = [];
  for (const symbol of symbols) {
    const quote = await getCached<NormalizedQuote>(env.MKR_CACHE, cacheKey('quote', symbol));
    if (!quote) continue;
    const changeText = quote.changePercent === null ? 'change unknown' : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`;
    lines.push(`${symbol}: ${quote.price} (${changeText}), session ${quote.sessionStatus}`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No live quote data is currently cached.';
}

/**
 * 2026-09-17 Final UX/Reliability task - live smoke found `/ai/asset-insight`
 * returning a generic "no available data" summary for XAU/USD and NVDA even
 * though both had real, working live quotes at the same moment. Root cause
 * (confirmed via live investigation): this route only ever did a PASSIVE KV
 * read of whatever another route happened to have already cached under the
 * same key - a cold/expired/never-yet-warmed cache entry silently produced
 * the literal fallback string "No live quote data is currently cached.",
 * which the model then honestly paraphrased (per its own "never invent a
 * number" system prompt) into what looked like a data bug but was actually
 * this route never fetching anything itself.
 *
 * Fixed by giving this single-symbol route the exact same active-fetch path
 * `/market/quote` uses (`requireSymbolRow` + `cachedFetch` +
 * `manager.getQuote` under the identical `cacheKey('quote', symbol)`) -
 * this is a single bounded request for the one symbol the user is already
 * looking at (Market Detail screen), never a burst, and it now shares a
 * cache entry with `/market/quote` instead of only ever reading one no
 * other route is obligated to have populated yet.
 */
async function liveQuoteContext(env: Env, requestId: string, symbols: string[]): Promise<string> {
  const config = await getConfig(env);
  const lines: string[] = [];
  for (const symbol of symbols) {
    try {
      const row = await requireSymbolRow(env, symbol);
      const symbolFor = (id: ProviderId) => mapSymbolFromRows([row], symbol, id);
      const preferredProvider = resolvePreferredProvider(row.category, row.alpaca_symbol !== null, config.featureFlags) ?? undefined;
      const ttl = row.cache_ttl_seconds ?? config.cacheTtls.quoteSeconds;
      const { value: quote } = await cachedFetch(env.MKR_CACHE, cacheKey('quote', symbol), ttl, async () => {
        const manager = await managerFor(env, config);
        const { result } = await manager.getQuote(symbol, symbolFor, 'P1', preferredProvider); // user is actively viewing this symbol's AI insight
        return result;
      });
      if (!quote) continue;
      const changeText = quote.changePercent === null ? 'change unknown' : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`;
      lines.push(`${symbol}: ${quote.price} (${changeText}), session ${quote.sessionStatus}`);
    } catch (err) {
      // One symbol's genuine fetch failure (disabled/unknown symbol,
      // provider transiently down) must not fail the whole insight - it
      // just means thinner grounding for that symbol, same "never fabricate"
      // contract as the passive path above.
      logError('AI live quote-context fetch failed', { requestId, symbol, message: (err as Error).message });
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No live quote data is currently available.';
}

/** Daily market brief for Home's "AI Market Brief" card - grounded in
 * whatever quotes are currently cache-warm (never forces a fresh provider
 * fetch just for this; a cold cache simply means less specific grounding
 * data, never fabricated numbers).
 *
 * 2026-09-17 Final UX/Reliability task: DXY/US10Y/OIL were removed from
 * this list - the prior catalog-expansion pass disabled all three
 * (confirmed genuinely unsupported on the current Twelve Data plan), so
 * no route has requested them since and this context permanently lost
 * 3 of its 5 grounding symbols. Replaced with symbols confirmed live in
 * the current enabled catalog and likely already cache-warm from Home's
 * own concurrent quote requests. */
export async function handleAiBrief(_request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const context = await cachedQuoteContext(env, ['XAU/USD', 'BTC', 'ETH', 'NVDA', 'EUR/USD']);
  const insight = await runInsight(
    env,
    requestId,
    'ai/brief',
    `Write a short daily market brief for a general audience using ONLY the following live quote data as your factual grounding:\n${context}`,
  );
  return jsonResponse(insight);
}

/** Per-symbol insight for a Market Detail screen - see [liveQuoteContext]'s
 * doc comment for the real-data bug this route previously had. */
export async function handleAiAssetInsight(request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const body = (await request.json().catch(() => null)) as { symbol?: string } | null;
  const rawSymbol = body?.symbol?.trim();
  if (!rawSymbol) throw new ApiError('INVALID_PARAMETER', 'symbol is required');
  // Matches /market/quote's own normalization exactly (market-routes.ts) -
  // previously this route skipped `.toUpperCase()`, so a differently-cased
  // request from any future call site would have produced a distinct cache
  // key and guaranteed a permanent miss.
  const symbol = rawSymbol.toUpperCase();
  const context = await liveQuoteContext(env, requestId, [symbol]);
  logInfo('ai asset-insight context resolved', { requestId, symbol, hadLiveData: !context.startsWith('No live quote data') });
  const insight = await runInsight(
    env,
    requestId,
    'ai/asset-insight',
    `Write a short analysis of ${symbol} for a general audience using ONLY the following live quote data as your factual grounding:\n${context}`,
  );
  return jsonResponse(insight);
}

/** Summarizes a news article the client already has (real or, today, mock
 * preview content) - the AI call itself is real regardless of whether the
 * input article is. */
export async function handleAiNewsSummary(request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const body = (await request.json().catch(() => null)) as { headline?: string; summary?: string; category?: string } | null;
  if (!body?.headline || !body?.summary) throw new ApiError('INVALID_PARAMETER', 'headline and summary are required');
  const insight = await runInsight(
    env,
    requestId,
    'ai/news-summary',
    `Summarize and add market context to this news article.\nHeadline: ${body.headline}\nCategory: ${body.category ?? 'unknown'}\nArticle text: ${body.summary}`,
  );
  return jsonResponse(insight);
}

/** Analyzes the likely market impact of an economic calendar event the
 * client already has (real or, today, mock preview content). */
export async function handleAiEventImpact(request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const body = (await request.json().catch(() => null)) as {
    title?: string;
    country?: string;
    previous?: string;
    forecast?: string;
    actual?: string;
  } | null;
  if (!body?.title) throw new ApiError('INVALID_PARAMETER', 'title is required');
  const insight = await runInsight(
    env,
    requestId,
    'ai/event-impact',
    `Analyze the likely market impact of this economic calendar event.\nEvent: ${body.title}\nCountry: ${body.country ?? 'unknown'}\nPrevious: ${body.previous ?? 'n/a'}\nForecast: ${body.forecast ?? 'n/a'}\nActual: ${body.actual ?? 'not yet released'}`,
  );
  return jsonResponse(insight);
}

/** Free-text Q&A for the AI Ask screen - plain string response, no
 * structured-JSON instruction (unlike the other four routes above). */
export async function handleAiAsk(request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();
  if (!question) throw new ApiError('INVALID_PARAMETER', 'question is required');

  let raw: unknown;
  try {
    raw = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SAFETY_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
      max_tokens: 500,
    });
  } catch (err) {
    logError('AI run failed', { requestId, route: 'ai/ask', message: (err as Error).message });
    throw new ApiError('PROVIDER_UNAVAILABLE', 'AI provider request failed.');
  }
  const answer = extractModelText(raw, 'ai/ask');
  if (!answer.trim()) throw new ApiError('INTERNAL_ERROR', 'AI returned an empty response.');
  return jsonResponse({ answer });
}
