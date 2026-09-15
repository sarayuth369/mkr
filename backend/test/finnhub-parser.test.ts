import { describe, expect, it } from 'vitest';
import { parseFinnhubEconomicCalendar, parseFinnhubNews } from '../src/news/finnhub-parser';

describe('parseFinnhubNews', () => {
  it('parses a well-formed news array', () => {
    const articles = parseFinnhubNews([
      {
        category: 'general',
        datetime: 1700000000,
        headline: 'Gold hits record high',
        id: 12345,
        related: 'GOLD,XAU',
        source: 'Reuters',
        summary: 'Bullion rallied on rate-cut bets.',
      },
    ]);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      id: '12345',
      headline: 'Gold hits record high',
      source: 'Reuters',
      timestamp: 1700000000 * 1000,
      category: 'general',
      impact: 'medium',
      affectedAssets: ['GOLD', 'XAU'],
      summary: 'Bullion rallied on rate-cut bets.',
    });
  });

  it('returns an empty affectedAssets list when related is empty, never a fabricated one', () => {
    const articles = parseFinnhubNews([
      { headline: 'X', summary: 'Y', datetime: 1, related: '' },
    ]);
    expect(articles[0]?.affectedAssets).toEqual([]);
  });

  it('skips an entry missing headline, summary, or datetime rather than fabricating placeholders', () => {
    expect(parseFinnhubNews([{ summary: 'Y', datetime: 1 }])).toHaveLength(0);
    expect(parseFinnhubNews([{ headline: 'X', datetime: 1 }])).toHaveLength(0);
    expect(parseFinnhubNews([{ headline: 'X', summary: 'Y' }])).toHaveLength(0);
  });

  it('falls back to source "Finnhub" and category "General" when absent, never blank', () => {
    const articles = parseFinnhubNews([{ headline: 'X', summary: 'Y', datetime: 1 }]);
    expect(articles[0]?.source).toBe('Finnhub');
    expect(articles[0]?.category).toBe('General');
  });

  it('synthesizes a stable id when Finnhub omits one, rather than crashing', () => {
    const articles = parseFinnhubNews([{ headline: 'X', summary: 'Y', datetime: 1 }]);
    expect(articles[0]?.id).toBe('1-X');
  });

  it('returns empty for a non-array response (e.g. an auth-failure page or error object)', () => {
    expect(parseFinnhubNews({ error: 'unauthorized' })).toEqual([]);
    expect(parseFinnhubNews(null)).toEqual([]);
    expect(parseFinnhubNews(undefined)).toEqual([]);
  });

  it('skips individual malformed entries without dropping the whole batch', () => {
    const articles = parseFinnhubNews([
      { headline: 'Good one', summary: 'S', datetime: 1 },
      'not an object',
      null,
      { headline: 'Also good', summary: 'S2', datetime: 2 },
    ]);
    expect(articles.map((a) => a.headline)).toEqual(['Good one', 'Also good']);
  });
});

describe('parseFinnhubEconomicCalendar', () => {
  it('parses a well-formed { economicCalendar: [...] } response', () => {
    const events = parseFinnhubEconomicCalendar({
      economicCalendar: [
        { country: 'US', event: 'CPI (YoY)', impact: 'high', prev: 3.1, estimate: 2.9, actual: null, time: '2026-01-15 19:30:00', unit: '%' },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'US-CPI (YoY)-2026-01-15 19:30:00',
      country: 'US',
      title: 'CPI (YoY)',
      impact: 'high',
      previous: '3.1%',
      forecast: '2.9%',
      actual: null,
    });
    expect(events[0]?.dateTime).toBe(Date.parse('2026-01-15T19:30:00Z'));
  });

  it('also accepts a bare array response, defensively', () => {
    const events = parseFinnhubEconomicCalendar([
      { country: 'EU', event: 'ECB Rate Decision', impact: 'high', time: '2026-01-15 15:30:00' },
    ]);
    expect(events).toHaveLength(1);
  });

  it('maps impact case-insensitively and defaults an unrecognized shape to low, never fabricating high', () => {
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00', impact: 'HIGH' }] })[0]?.impact).toBe('high');
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00', impact: 'Medium' }] })[0]?.impact).toBe('medium');
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00', impact: 'weird' }] })[0]?.impact).toBe('low');
  });

  it('maps a numeric impact severity (0-3) as a fallback shape', () => {
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00', impact: 3 }] })[0]?.impact).toBe('high');
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00', impact: 2 }] })[0]?.impact).toBe('medium');
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00', impact: 1 }] })[0]?.impact).toBe('low');
  });

  it('leaves previous/forecast/actual null when Finnhub omits them, never a fabricated 0', () => {
    const events = parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', event: 'X', time: '2026-01-01 00:00:00' }] });
    expect(events[0]).toMatchObject({ previous: null, forecast: null, actual: null });
  });

  it('skips an entry missing event, country, or time rather than fabricating placeholders', () => {
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ country: 'US', time: '2026-01-01 00:00:00' }] })).toHaveLength(0);
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ event: 'X', time: '2026-01-01 00:00:00' }] })).toHaveLength(0);
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ event: 'X', country: 'US' }] })).toHaveLength(0);
  });

  it('skips an entry with an unparseable time string', () => {
    expect(parseFinnhubEconomicCalendar({ economicCalendar: [{ event: 'X', country: 'US', time: 'not-a-date' }] })).toHaveLength(0);
  });

  it('returns empty for a completely unexpected response shape', () => {
    expect(parseFinnhubEconomicCalendar({ error: 'unauthorized' })).toEqual([]);
    expect(parseFinnhubEconomicCalendar(null)).toEqual([]);
  });
});
