import { describe, expect, it } from 'vitest';
import { parseFinnhubNews } from '../src/news/finnhub-parser';

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
