import { describe, expect, it } from 'vitest';
import { CuratedScheduleProvider } from '../src/calendar/providers/curated-provider';

describe('CuratedScheduleProvider - official-source curated schedule', () => {
  it('is marked non-commercial - always eligible without any opt-in', async () => {
    const provider = new CuratedScheduleProvider();
    expect(provider.commercial).toBe(false);
    expect(provider.id).toBe('curated_official');
  });

  it('filters events to exactly the requested range', async () => {
    const provider = new CuratedScheduleProvider();
    const all = await provider.fetchEvents({ fromMs: 0, toMs: Date.UTC(2027, 0, 1) });
    const narrow = await provider.fetchEvents({ fromMs: Date.UTC(2026, 8, 1), toMs: Date.UTC(2026, 8, 30) });

    expect(all.length).toBeGreaterThan(narrow.length);
    for (const event of narrow) {
      expect(event.eventTimeUtc).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 1));
      expect(event.eventTimeUtc).toBeLessThanOrEqual(Date.UTC(2026, 8, 30));
    }
  });

  it('produces deterministic, stable ids of the form source:sourceEventId', async () => {
    const provider = new CuratedScheduleProvider();
    const events = await provider.fetchEvents({ fromMs: 0, toMs: Date.UTC(2027, 0, 1) });
    for (const event of events) {
      expect(event.id).toBe(`${event.source}:${event.sourceEventId}`);
      expect(event.source).toBe('curated_official');
    }
  });

  it('produces no duplicate ids - one row per real-world event', async () => {
    const provider = new CuratedScheduleProvider();
    const events = await provider.fetchEvents({ fromMs: 0, toMs: Date.UTC(2027, 0, 1) });
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('re-fetching the same range is fully deterministic (idempotent at the provider level)', async () => {
    const provider = new CuratedScheduleProvider();
    const range = { fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2027, 0, 1) };
    const first = await provider.fetchEvents(range);
    const second = await provider.fetchEvents(range);
    expect(first.map((e) => e.id).sort()).toEqual(second.map((e) => e.id).sort());
  });

  it('never fabricates previous/consensus/actual - a schedule-only source leaves every numeric value null', async () => {
    const provider = new CuratedScheduleProvider();
    const events = await provider.fetchEvents({ fromMs: 0, toMs: Date.UTC(2027, 0, 1) });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.previous).toBeNull();
      expect(event.consensus).toBeNull();
      expect(event.actual).toBeNull();
    }
  });

  it('applies MKR classification consistently - an FOMC entry is monetary_policy/high', async () => {
    const provider = new CuratedScheduleProvider();
    const events = await provider.fetchEvents({ fromMs: 0, toMs: Date.UTC(2027, 0, 1) });
    const fomc = events.filter((e) => e.title.includes('FOMC'));
    expect(fomc.length).toBeGreaterThan(0);
    for (const event of fomc) {
      expect(event.category).toBe('monetary_policy');
      expect(event.importance).toBe('high');
    }
  });

  it('every event has a non-null sourceUrl pointing at the official source', async () => {
    const provider = new CuratedScheduleProvider();
    const events = await provider.fetchEvents({ fromMs: 0, toMs: Date.UTC(2027, 0, 1) });
    for (const event of events) {
      expect(event.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('an out-of-range window returns no events, honestly - never fabricates a placeholder', async () => {
    const provider = new CuratedScheduleProvider();
    const events = await provider.fetchEvents({ fromMs: Date.UTC(2030, 0, 1), toMs: Date.UTC(2030, 1, 1) });
    expect(events).toEqual([]);
  });
});
