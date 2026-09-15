import { afterEach, describe, expect, it, vi } from 'vitest';
import { FmpCalendarProvider, parseFmpCalendarEvents } from '../src/calendar/providers/fmp-provider';
import { CalendarProviderError } from '../src/calendar/providers/types';

describe('parseFmpCalendarEvents - normalization + malformed data (future, not-yet-active provider)', () => {
  it('parses a well-formed FMP response into canonical numeric+unit fields', () => {
    const events = parseFmpCalendarEvents([
      { country: 'US', event: 'CPI (YoY)', currency: 'USD', impact: 'High', previous: 3.1, estimate: 2.9, actual: null, date: '2026-01-15 19:30:00', unit: '%' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'fmp:US-CPI (YoY)-2026-01-15 19:30:00',
      source: 'fmp',
      country: 'US',
      currency: 'USD',
      title: 'CPI (YoY)',
      previous: 3.1,
      consensus: 2.9,
      actual: null,
      unit: '%',
    });
    expect(events[0]?.eventTimeUtc).toBe(Date.parse('2026-01-15T19:30:00Z'));
  });

  it('never copies FMP\'s own "impact" as importance - MKR classification is used instead', () => {
    const events = parseFmpCalendarEvents([{ country: 'US', event: 'CPI (YoY)', date: '2026-01-15 19:30:00', impact: 'High' }]);
    // classifyEvent('CPI (YoY)') resolves to 'high' too here, but via MKR's
    // own keyword rule, not by trusting item.impact directly - confirmed by
    // the sibling test below where FMP's impact and MKR's classification disagree.
    expect(events[0]?.importance).toBe('high');
  });

  it('an event whose title MKR does not recognize gets MKR\'s own "unknown" importance even when FMP labels it High - proving impact is never copied', () => {
    const events = parseFmpCalendarEvents([{ country: 'US', event: 'Some Obscure Indicator', date: '2026-01-15 19:30:00', impact: 'High' }]);
    expect(events[0]?.importance).toBe('unknown');
  });

  it('leaves previous/consensus/actual null when FMP omits them, never a fabricated 0', () => {
    const events = parseFmpCalendarEvents([{ country: 'US', event: 'X', date: '2026-01-01 00:00:00' }]);
    expect(events[0]).toMatchObject({ previous: null, consensus: null, actual: null });
  });

  it('formats a zero actual as a real 0, not null - zero is a real value, not absence', () => {
    const events = parseFmpCalendarEvents([{ country: 'US', event: 'X', date: '2026-01-01 00:00:00', actual: 0 }]);
    expect(events[0]?.actual).toBe(0);
  });

  it('skips an entry missing event, country, or date rather than fabricating placeholders', () => {
    expect(parseFmpCalendarEvents([{ country: 'US', date: '2026-01-01 00:00:00' }])).toHaveLength(0);
    expect(parseFmpCalendarEvents([{ event: 'X', date: '2026-01-01 00:00:00' }])).toHaveLength(0);
    expect(parseFmpCalendarEvents([{ event: 'X', country: 'US' }])).toHaveLength(0);
  });

  it('skips an entry with an unparseable date string', () => {
    expect(parseFmpCalendarEvents([{ event: 'X', country: 'US', date: 'not-a-date' }])).toHaveLength(0);
  });

  it('skips individual malformed entries without dropping the whole batch', () => {
    const events = parseFmpCalendarEvents([
      { country: 'US', event: 'Good one', date: '2026-01-01 00:00:00' },
      'not an object',
      null,
      { country: 'EU', event: 'Also good', date: '2026-01-02 00:00:00' },
    ]);
    expect(events.map((e) => e.title)).toEqual(['Good one', 'Also good']);
  });

  it('returns empty for a non-array response (e.g. an auth-failure/plan-restriction error object)', () => {
    expect(parseFmpCalendarEvents({ 'Error Message': 'Invalid API KEY.' })).toEqual([]);
    expect(parseFmpCalendarEvents(null)).toEqual([]);
    expect(parseFmpCalendarEvents(undefined)).toEqual([]);
  });

  it('produces deterministic ids from the same input', () => {
    const input = [{ country: 'US', event: 'CPI (YoY)', date: '2026-01-15 19:30:00' }];
    expect(parseFmpCalendarEvents(input)[0]?.id).toBe(parseFmpCalendarEvents(input)[0]?.id);
  });
});

describe('FmpCalendarProvider - marked commercial, isolated failure classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is marked commercial - never selected by the manager without explicit opt-in (see provider-manager.ts)', () => {
    const provider = new FmpCalendarProvider('fake-fmp-key-not-real');
    expect(provider.commercial).toBe(true);
    expect(provider.id).toBe('fmp');
  });

  it('a non-2xx response (e.g. the confirmed-live 402 Payment Required) surfaces as CalendarProviderError, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Payment Required', { status: 402 })));
    const provider = new FmpCalendarProvider('fake-fmp-key-not-real');

    await expect(provider.fetchEvents({ fromMs: 0, toMs: Date.now() })).rejects.toBeInstanceOf(CalendarProviderError);
  });
});
