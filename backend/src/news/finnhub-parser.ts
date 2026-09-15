// Pure JSON parsing for Finnhub's documented response shapes - no
// networking here, unit-testable against fixture JSON including malformed/
// missing-field shapes, same discipline as twelve-data-parser.ts.

export interface NormalizedNewsArticle {
  id: string;
  headline: string;
  source: string;
  timestamp: number; // epoch ms
  category: string;
  impact: 'high' | 'medium' | 'low';
  affectedAssets: string[];
  summary: string;
}

export interface NormalizedEconomicEvent {
  id: string;
  dateTime: number; // epoch ms
  country: string;
  title: string;
  impact: 'high' | 'medium' | 'low';
  previous: string | null;
  forecast: string | null;
  actual: string | null;
}

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

function parseImpact(value: unknown): 'high' | 'medium' | 'low' {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'high') return 'high';
    if (lower === 'medium' || lower === 'med') return 'medium';
    if (lower === 'low') return 'low';
  }
  if (typeof value === 'number') {
    // Finnhub has also been observed returning impact as a 0-3 severity
    // number on some plans/endpoints rather than a string - 3 is highest.
    if (value >= 3) return 'high';
    if (value === 2) return 'medium';
    return 'low';
  }
  return 'low'; // never guess upward - an unrecognized shape defaults to the least attention-grabbing rating
}

/**
 * `GET /calendar/economic` returns `{ economicCalendar: [...] }`. Also
 * defensively accepts a bare array in case a future Finnhub response
 * shape drops the wrapper - never throws either way, just returns empty.
 */
export function parseFinnhubEconomicCalendar(json: unknown): NormalizedEconomicEvent[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).economicCalendar)
      ? ((json as Record<string, unknown>).economicCalendar as unknown[])
      : null;
  if (!list) return [];

  const events: NormalizedEconomicEvent[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const title = str(item.event);
    const country = str(item.country);
    const timeStr = str(item.time);
    if (!title || !country || !timeStr) continue; // never fabricate a missing event/country/time

    // Finnhub's `time` is a "YYYY-MM-DD HH:mm:ss" string with no explicit
    // timezone marker - treated as UTC (append 'Z') rather than guessing
    // the reader's local offset, matching every other timestamp this
    // backend hands to Flutter (epoch ms, UTC-based).
    const parsedTime = Date.parse(`${timeStr.replace(' ', 'T')}Z`);
    if (Number.isNaN(parsedTime)) continue;

    const previous = num(item.prev);
    const forecast = num(item.estimate);
    const actual = num(item.actual);
    const unit = str(item.unit) ?? '';

    events.push({
      id: `${country}-${title}-${timeStr}`,
      dateTime: parsedTime,
      country,
      title,
      impact: parseImpact(item.impact),
      previous: previous === null ? null : `${previous}${unit}`,
      forecast: forecast === null ? null : `${forecast}${unit}`,
      actual: actual === null ? null : `${actual}${unit}`,
    });
  }
  return events;
}
