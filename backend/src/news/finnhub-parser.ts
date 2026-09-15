// Pure JSON parsing for Finnhub's documented response shapes - no
// networking here, unit-testable against fixture JSON including malformed/
// missing-field shapes, same discipline as twelve-data-parser.ts.
//
// News only - Finnhub's economic calendar endpoint is a paid-plan-only
// feature (confirmed live 2026-09-15: "Economic Calendar Premium" per
// Finnhub's own docs) and is not called anywhere in this codebase; see
// fmp-parser.ts for that surface instead.

import type { NormalizedNewsArticle } from './types';

export type { NormalizedNewsArticle };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Finnhub's general news doesn't come with a provider-assigned impact
 * rating (unlike the economic calendar, which does) - defaulting every
 * article to 'medium' is an honest "no signal available" choice, not a
 * fabricated rating. Never upgraded/downgraded based on guessed content.
 */
const DEFAULT_NEWS_IMPACT = 'medium' as const;

/**
 * `GET /news` returns a bare JSON array (not an error-object envelope like
 * Twelve Data) - an unexpected shape (auth failure page, empty body, a
 * single error object) simply parses to zero articles rather than
 * throwing, since a malformed response here is never worth crashing the
 * whole News Radar screen over.
 */
export function parseFinnhubNews(json: unknown): NormalizedNewsArticle[] {
  if (!Array.isArray(json)) return [];
  const articles: NormalizedNewsArticle[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const headline = str(item.headline);
    const summary = str(item.summary);
    const datetimeSeconds = num(item.datetime);
    if (!headline || !summary || datetimeSeconds === null) continue; // never fabricate a missing headline/summary/timestamp

    const related = str(item.related);
    const affectedAssets = related ? related.split(',').map((s) => s.trim()).filter(Boolean) : [];

    articles.push({
      id: item.id !== undefined && item.id !== null ? String(item.id) : `${datetimeSeconds}-${headline}`,
      headline,
      source: str(item.source) ?? 'Finnhub',
      timestamp: datetimeSeconds * 1000,
      category: str(item.category) ?? 'General',
      impact: DEFAULT_NEWS_IMPACT,
      affectedAssets,
      summary,
    });
  }
  return articles;
}
