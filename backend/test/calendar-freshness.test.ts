import { describe, expect, it } from 'vitest';
import { computeFreshness, mostRecentSuccessAt } from '../src/calendar/freshness';
import type { CalendarSourceState } from '../src/calendar/types';

function state(overrides: Partial<CalendarSourceState> = {}): CalendarSourceState {
  return { source: 'src', lastSuccessAt: null, lastFailureAt: null, lastErrorMessage: null, lastEventCount: 0, ...overrides };
}

describe('computeFreshness - centralized, never LIVE merely because data exists', () => {
  const now = Date.now();

  it('OFFLINE when no usable data exists at all, regardless of source state', () => {
    expect(computeFreshness([state({ lastSuccessAt: now })], false, now)).toBe('offline');
  });

  it('LIVE when at least one source succeeded within the freshness window', () => {
    expect(computeFreshness([state({ lastSuccessAt: now - 60_000 })], true, now)).toBe('live');
  });

  it('STALE when a source has succeeded before but not recently - data exists and is served, but honestly labeled aging', () => {
    const thirteenHoursAgo = now - 13 * 60 * 60 * 1000;
    expect(computeFreshness([state({ lastSuccessAt: thirteenHoursAgo })], true, now)).toBe('stale');
  });

  it('DEGRADED when data exists (e.g. the always-on curated provider) but no source has ever recorded a successful ingestion yet', () => {
    expect(computeFreshness([state({ lastSuccessAt: null, lastFailureAt: now })], true, now)).toBe('degraded');
  });

  it('DEGRADED with zero source records at all but data still exists', () => {
    expect(computeFreshness([], true, now)).toBe('degraded');
  });

  it('one live source among several stale/failed ones is enough for LIVE', () => {
    const sources = [state({ source: 'a', lastSuccessAt: now - 20 * 60 * 60 * 1000 }), state({ source: 'b', lastSuccessAt: now - 60_000 })];
    expect(computeFreshness(sources, true, now)).toBe('live');
  });
});

describe('mostRecentSuccessAt', () => {
  it('returns null when nothing has ever succeeded', () => {
    expect(mostRecentSuccessAt([state()])).toBeNull();
  });

  it('returns the maximum lastSuccessAt across sources', () => {
    const sources = [state({ source: 'a', lastSuccessAt: 100 }), state({ source: 'b', lastSuccessAt: 500 }), state({ source: 'c', lastSuccessAt: 300 })];
    expect(mostRecentSuccessAt(sources)).toBe(500);
  });
});
