import { cacheKey, getCached } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { ApiError, jsonResponse } from '../errors';
import { logError } from '../logging';
import type { Env, NormalizedQuote } from '../types';

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

function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new ApiError('INTERNAL_ERROR', 'AI response was not valid JSON.');
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'AI response was not valid JSON.');
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseInsight(text: string): AiInsightPayload {
  const parsed = extractJsonObject(text) as Record<string, unknown>;
  const summary = parsed.summary;
  const whyItMatters = parsed.whyItMatters;
  const marketImpact = parsed.marketImpact;
  if (typeof summary !== 'string' || typeof whyItMatters !== 'string' || typeof marketImpact !== 'string') {
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

/** Cloudflare Workers AI text-generation model - fast/cheap, good enough
 * for short structured summaries; no external account/key required. */
const MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;

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
  const text = raw && typeof raw === 'object' && 'response' in raw ? String((raw as { response: unknown }).response ?? '') : '';
  return parseInsight(text);
}

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

/** Daily market brief for Home's "AI Market Brief" card - grounded in
 * whatever quotes are currently cache-warm (never forces a fresh provider
 * fetch just for this; a cold cache simply means less specific grounding
 * data, never fabricated numbers). */
export async function handleAiBrief(_request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const context = await cachedQuoteContext(env, ['XAU/USD', 'BTC', 'DXY', 'US10Y', 'OIL']);
  const insight = await runInsight(
    env,
    requestId,
    'ai/brief',
    `Write a short daily market brief for a general audience using ONLY the following live quote data as your factual grounding:\n${context}`,
  );
  return jsonResponse(insight);
}

/** Per-symbol insight for a Market Detail screen. */
export async function handleAiAssetInsight(request: Request, env: Env, requestId: string): Promise<Response> {
  await requireAiEnabled(env);
  const body = (await request.json().catch(() => null)) as { symbol?: string } | null;
  const symbol = body?.symbol?.trim();
  if (!symbol) throw new ApiError('INVALID_PARAMETER', 'symbol is required');
  const context = await cachedQuoteContext(env, [symbol]);
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
  const answer = raw && typeof raw === 'object' && 'response' in raw ? String((raw as { response: unknown }).response ?? '') : '';
  if (!answer.trim()) throw new ApiError('INTERNAL_ERROR', 'AI returned an empty response.');
  return jsonResponse({ answer });
}
