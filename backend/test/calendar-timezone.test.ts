import { describe, expect, it } from 'vitest';
import { eventTimeLocal, timezoneForCountry, utcFromLocalWallClock } from '../src/calendar/timezone';

describe('timezoneForCountry', () => {
  it('maps known countries/areas to their IANA timezone', () => {
    expect(timezoneForCountry('US')).toBe('America/New_York');
    expect(timezoneForCountry('EU')).toBe('Europe/Berlin');
    expect(timezoneForCountry('UK')).toBe('Europe/London');
    expect(timezoneForCountry('JP')).toBe('Asia/Tokyo');
  });

  it('is case-insensitive', () => {
    expect(timezoneForCountry('us')).toBe('America/New_York');
  });

  it('falls back to UTC for an unrecognized code - never guesses a timezone', () => {
    expect(timezoneForCountry('ZZ')).toBe('UTC');
  });
});

describe('utcFromLocalWallClock - DST-correct local-to-UTC conversion', () => {
  it('converts a US Eastern winter (EST, UTC-5) local time correctly', () => {
    // Jan 28, 2026 14:00 EST = 19:00 UTC (winter, no DST).
    const utcMs = utcFromLocalWallClock(2026, 1, 28, 14, 0, 'America/New_York');
    expect(new Date(utcMs).toISOString()).toBe('2026-01-28T19:00:00.000Z');
  });

  it('converts a US Eastern summer (EDT, UTC-4) local time correctly - the exact DST case a hand-computed fixed offset would get wrong', () => {
    // Sep 16, 2026 14:00 EDT = 18:00 UTC (DST in effect).
    const utcMs = utcFromLocalWallClock(2026, 9, 16, 14, 0, 'America/New_York');
    expect(new Date(utcMs).toISOString()).toBe('2026-09-16T18:00:00.000Z');
  });

  it('converts European Central Time (CET/CEST) correctly for both winter and summer', () => {
    // Dec 17, 2026 14:15 CET (winter, UTC+1) = 13:15 UTC.
    expect(new Date(utcFromLocalWallClock(2026, 12, 17, 14, 15, 'Europe/Berlin')).toISOString()).toBe('2026-12-17T13:15:00.000Z');
    // A summer date should reflect CEST (UTC+2) instead.
    expect(new Date(utcFromLocalWallClock(2026, 7, 1, 14, 15, 'Europe/Berlin')).toISOString()).toBe('2026-07-01T12:15:00.000Z');
  });

  it('converts Japan Standard Time (no DST, fixed UTC+9) correctly', () => {
    expect(new Date(utcFromLocalWallClock(2026, 9, 18, 0, 0, 'Asia/Tokyo')).toISOString()).toBe('2026-09-17T15:00:00.000Z');
  });
});

describe('eventTimeLocal', () => {
  it('formats the local wall-clock time in the event country\'s own timezone, not UTC', () => {
    const utcMs = Date.UTC(2026, 8, 16, 18, 0, 0); // 2026-09-16T18:00:00Z = 14:00 EDT
    expect(eventTimeLocal(utcMs, 'US')).toBe('2026-09-16T14:00:00');
  });

  it('round-trips with utcFromLocalWallClock for the same timezone', () => {
    const utcMs = utcFromLocalWallClock(2026, 12, 17, 14, 15, 'Europe/Berlin');
    expect(eventTimeLocal(utcMs, 'EU')).toBe('2026-12-17T14:15:00');
  });
});
