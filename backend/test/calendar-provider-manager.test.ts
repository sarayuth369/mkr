import { describe, expect, it } from 'vitest';
import { activeProviderIds, EconomicCalendarProviderManager } from '../src/calendar/provider-manager';
import { CalendarProviderError } from '../src/calendar/providers/types';
import type { CalendarFetchRange, EconomicCalendarProvider } from '../src/calendar/providers/types';
import type { EconomicEvent } from '../src/calendar/types';

function fakeEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'src:evt-1',
    source: 'src',
    sourceEventId: 'evt-1',
    country: 'US',
    currency: 'USD',
    title: 'Test Event',
    category: 'other',
    eventTimeUtc: Date.now() + 60_000,
    eventTimeLocal: '2026-01-01T00:00:00',
    importance: 'unknown',
    previous: null,
    consensus: null,
    actual: null,
    unit: null,
    status: 'unknown',
    relatedAssets: [],
    sourceUrl: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function fakeProvider(id: string, opts: { commercial?: boolean; events?: EconomicEvent[]; error?: Error } = {}): EconomicCalendarProvider {
  return {
    id,
    commercial: opts.commercial ?? false,
    async fetchEvents(_range: CalendarFetchRange) {
      if (opts.error) throw opts.error;
      return opts.events ?? [];
    },
  };
}

describe('EconomicCalendarProviderManager - failure isolation, dedupe, status', () => {
  it('one provider failing does not discard another provider\'s successfully-fetched events (provider selection/fallback)', async () => {
    const good = fakeProvider('good', { events: [fakeEvent({ id: 'good:1', source: 'good', sourceEventId: '1' })] });
    const bad = fakeProvider('bad', { error: new CalendarProviderError('boom', 'network') });
    const manager = new EconomicCalendarProviderManager([good, bad]);

    const { events, outcomes } = await manager.fetchAll({ fromMs: 0, toMs: Date.now() + 1_000_000 });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('good:1');
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { providerId: 'good', ok: true, eventCount: 1, errorMessage: null },
        { providerId: 'bad', ok: false, eventCount: 0, errorMessage: 'boom' },
      ]),
    );
  });

  it('dedupes by id across providers - never blindly merges two providers\' events into one fabricated row', async () => {
    const a = fakeProvider('a', { events: [fakeEvent({ id: 'a:1', source: 'a', sourceEventId: '1' })] });
    const b = fakeProvider('b', { events: [fakeEvent({ id: 'b:1', source: 'b', sourceEventId: '1' })] });
    const manager = new EconomicCalendarProviderManager([a, b]);

    const { events } = await manager.fetchAll({ fromMs: 0, toMs: Date.now() + 1_000_000 });

    expect(events.map((e) => e.id).sort()).toEqual(['a:1', 'b:1']);
  });

  it('a later provider re-reporting the exact same id overwrites the earlier one (last-write-wins within one fetch pass, not a fabricated merge)', async () => {
    const a = fakeProvider('a', { events: [fakeEvent({ id: 'x:1', source: 'x', sourceEventId: '1', title: 'First' })] });
    const b = fakeProvider('b', { events: [fakeEvent({ id: 'x:1', source: 'x', sourceEventId: '1', title: 'Second' })] });
    const manager = new EconomicCalendarProviderManager([a, b]);

    const { events } = await manager.fetchAll({ fromMs: 0, toMs: Date.now() + 1_000_000 });

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('Second');
  });

  it('computes status=released for a past event and status=scheduled for a future event, centrally (never per-provider)', async () => {
    const now = Date.now();
    const past = fakeEvent({ id: 'p:1', source: 'p', sourceEventId: '1', eventTimeUtc: now - 60_000 });
    const future = fakeEvent({ id: 'p:2', source: 'p', sourceEventId: '2', eventTimeUtc: now + 60_000 });
    const provider = fakeProvider('p', { events: [past, future] });
    const manager = new EconomicCalendarProviderManager([provider]);

    const { events } = await manager.fetchAll({ fromMs: 0, toMs: now + 1_000_000 }, now);

    expect(events.find((e) => e.id === 'p:1')?.status).toBe('released');
    expect(events.find((e) => e.id === 'p:2')?.status).toBe('scheduled');
  });

  it('preserves an explicit cancelled status from a provider rather than overwriting it with the time-based default', async () => {
    const now = Date.now();
    const cancelled = fakeEvent({ id: 'c:1', source: 'c', sourceEventId: '1', eventTimeUtc: now + 60_000, status: 'cancelled' });
    const provider = fakeProvider('c', { events: [cancelled] });
    const manager = new EconomicCalendarProviderManager([provider]);

    const { events } = await manager.fetchAll({ fromMs: 0, toMs: now + 1_000_000 }, now);

    expect(events[0]?.status).toBe('cancelled');
  });

  it('an empty provider set (or all providers returning nothing) yields an honest empty calendar, never fabricated events', async () => {
    const empty = fakeProvider('empty', { events: [] });
    const manager = new EconomicCalendarProviderManager([empty]);

    const { events } = await manager.fetchAll({ fromMs: 0, toMs: Date.now() + 1_000_000 });

    expect(events).toEqual([]);
  });
});

describe('activeProviderIds - commercial provider gating', () => {
  it('curated is always included even with no configuration', () => {
    expect(activeProviderIds([], new Set())).toEqual(['curated_official']);
  });

  it('a configured commercial id is included only when it is also in the available set (secret actually configured)', () => {
    expect(activeProviderIds(['fmp'], new Set(['fmp']))).toEqual(expect.arrayContaining(['curated_official', 'fmp']));
    expect(activeProviderIds(['fmp'], new Set())).toEqual(['curated_official']); // configured but no secret - never activated
  });

  it('an unrecognized configured id is silently ignored, never a fabricated provider', () => {
    expect(activeProviderIds(['not-a-real-provider'], new Set())).toEqual(['curated_official']);
  });
});
