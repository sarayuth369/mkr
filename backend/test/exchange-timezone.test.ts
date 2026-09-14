import { describe, expect, it } from 'vitest';
import { addLocalDays, localMidnightUtc, localMonthStartUtc, localNextMonthStartUtc, localParts, minutesOfDay, weekdayAt } from '../src/market/exchange-timezone';

const NY = 'America/New_York';

describe('localParts / weekdayAt / minutesOfDay - timezone conversion correctness', () => {
  it('converts a UTC instant to America/New_York wall-clock time correctly (EDT, UTC-4)', () => {
    // 2026-09-14T13:35:20Z is during EDT (verified via ICU: DST 2026 spans 2026-03-08 to 2026-11-01).
    const p = localParts(Date.UTC(2026, 8, 14, 13, 35, 20), NY);
    expect(p).toMatchObject({ year: 2026, month: 9, day: 14, hour: 9, minute: 35, second: 20 });
  });

  it('converts correctly during EST (UTC-5), outside DST', () => {
    // 2026-01-15 is well outside DST.
    const p = localParts(Date.UTC(2026, 0, 15, 13, 35, 0), NY);
    expect(p).toMatchObject({ year: 2026, month: 1, day: 15, hour: 8, minute: 35 });
  });

  it('weekdayAt matches JS Date weekday conventions (0=Sunday..6=Saturday) in the target timezone, not UTC', () => {
    // 2026-09-14 12:00 UTC = 2026-09-14 08:00 America/New_York, still the same calendar day/weekday (Monday=1).
    expect(weekdayAt(Date.UTC(2026, 8, 14, 12, 0, 0), NY)).toBe(1);
    // 2026-09-14 02:00 UTC = 2026-09-13 22:00 America/New_York (previous day, Sunday=0) - the exact
    // "early UTC day, still yesterday locally" case this task exists to fix.
    expect(weekdayAt(Date.UTC(2026, 8, 14, 2, 0, 0), NY)).toBe(0);
  });

  it('minutesOfDay reflects local time-of-day, not UTC time-of-day', () => {
    // 13:35 UTC = 09:35 EDT = 575 minutes since local midnight.
    expect(minutesOfDay(Date.UTC(2026, 8, 14, 13, 35, 0), NY)).toBe(9 * 60 + 35);
  });
});

describe('localMidnightUtc - DST-safe local calendar-day boundary', () => {
  it('2026-09-14 (EDT, UTC-4): local midnight is 04:00 UTC', () => {
    const mid = localMidnightUtc(Date.UTC(2026, 8, 14, 18, 0, 0), NY);
    expect(mid).toBe(Date.UTC(2026, 8, 14, 4, 0, 0));
  });

  it('2026-01-15 (EST, UTC-5): local midnight is 05:00 UTC', () => {
    const mid = localMidnightUtc(Date.UTC(2026, 0, 15, 18, 0, 0), NY);
    expect(mid).toBe(Date.UTC(2026, 0, 15, 5, 0, 0));
  });

  it('spring-forward DST transition (2026-03-08): local midnight the DAY OF the transition is still correctly EST (offset has not yet changed at 00:00 local - the transition itself happens at 02:00 local)', () => {
    // At 00:00 local on the transition day, EST (UTC-5) is still in effect
    // (the clock jumps forward at 02:00 local, not at midnight).
    const mid = localMidnightUtc(Date.UTC(2026, 2, 8, 12, 0, 0), NY); // noon UTC on the transition day
    expect(mid).toBe(Date.UTC(2026, 2, 8, 5, 0, 0)); // still UTC-5 at local midnight
  });

  it('the day AFTER spring-forward is correctly EDT (UTC-4)', () => {
    const mid = localMidnightUtc(Date.UTC(2026, 2, 9, 12, 0, 0), NY);
    expect(mid).toBe(Date.UTC(2026, 2, 9, 4, 0, 0));
  });

  it('fall-back DST transition (2026-11-01): local midnight is still EDT (UTC-4) - the transition happens at 02:00 local, not midnight', () => {
    const mid = localMidnightUtc(Date.UTC(2026, 10, 1, 12, 0, 0), NY);
    expect(mid).toBe(Date.UTC(2026, 10, 1, 4, 0, 0));
  });

  it('the day AFTER fall-back is correctly EST (UTC-5)', () => {
    const mid = localMidnightUtc(Date.UTC(2026, 10, 2, 12, 0, 0), NY);
    expect(mid).toBe(Date.UTC(2026, 10, 2, 5, 0, 0));
  });

  it('is idempotent - computing local midnight of an instant that is ALREADY local midnight returns itself', () => {
    const mid = localMidnightUtc(Date.UTC(2026, 8, 14, 18, 0, 0), NY);
    expect(localMidnightUtc(mid, NY)).toBe(mid);
  });
});

describe('addLocalDays - DST-safe day stepping', () => {
  it('stepping across the spring-forward transition still lands on the correct next local calendar day', () => {
    const march7Midnight = localMidnightUtc(Date.UTC(2026, 2, 7, 12, 0, 0), NY); // EST
    const march8Midnight = addLocalDays(march7Midnight, 1, NY);
    expect(march8Midnight).toBe(localMidnightUtc(Date.UTC(2026, 2, 8, 12, 0, 0), NY)); // EST still (transition day itself)
    const march9Midnight = addLocalDays(march8Midnight, 1, NY);
    expect(march9Midnight).toBe(localMidnightUtc(Date.UTC(2026, 2, 9, 12, 0, 0), NY)); // EDT (day after transition)
  });

  it('stepping across the fall-back transition lands correctly too', () => {
    const oct31Midnight = localMidnightUtc(Date.UTC(2026, 9, 31, 12, 0, 0), NY); // EDT
    const nov1Midnight = addLocalDays(oct31Midnight, 1, NY);
    expect(nov1Midnight).toBe(localMidnightUtc(Date.UTC(2026, 10, 1, 12, 0, 0), NY)); // EDT (transition day itself)
  });

  it('negative steps (previous day) work correctly', () => {
    const sept14 = localMidnightUtc(Date.UTC(2026, 8, 14, 12, 0, 0), NY);
    const sept13 = addLocalDays(sept14, -1, NY);
    expect(sept13).toBe(localMidnightUtc(Date.UTC(2026, 8, 13, 12, 0, 0), NY));
  });
});

describe('localMonthStartUtc / localNextMonthStartUtc', () => {
  it('resolves the 1st of the current local month at local midnight', () => {
    const start = localMonthStartUtc(Date.UTC(2026, 8, 14, 18, 0, 0), NY); // Sept 14, EDT
    expect(start).toBe(Date.UTC(2026, 8, 1, 4, 0, 0)); // Sept 1 00:00 EDT = 04:00 UTC
  });

  it('the next month start correctly rolls the year over in December', () => {
    const nextStart = localNextMonthStartUtc(Date.UTC(2026, 11, 15, 12, 0, 0), NY); // Dec 15
    expect(nextStart).toBe(Date.UTC(2027, 0, 1, 5, 0, 0)); // Jan 1 2027 00:00 EST = 05:00 UTC
  });

  it('a month boundary whose 1st-of-month falls exactly on the DST transition day still resolves to the correct (pre-transition) offset', () => {
    // November 2026's fall-back transition IS on Nov 1 itself (at 02:00 local) -
    // local midnight of Nov 1 is still EDT (the clock hasn't rolled back yet).
    const start = localMonthStartUtc(Date.UTC(2026, 10, 15, 12, 0, 0), NY); // mid-November, already EST
    expect(start).toBe(Date.UTC(2026, 10, 1, 4, 0, 0)); // Nov 1 00:00 local = still EDT (UTC-4) = 04:00 UTC
  });
});
