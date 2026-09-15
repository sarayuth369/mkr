import { describe, expect, it } from 'vitest';
import { CalendarStore } from '../src/calendar/store';
import type { EconomicEvent } from '../src/calendar/types';
import { createFakeCalendarD1 } from './calendar-fakes';

function makeEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'curated_official:fomc-2026-09-16',
    source: 'curated_official',
    sourceEventId: 'fomc-2026-09-16',
    country: 'US',
    currency: 'USD',
    title: 'FOMC Interest Rate Decision',
    category: 'monetary_policy',
    eventTimeUtc: Date.UTC(2026, 8, 16, 18, 0, 0),
    eventTimeLocal: '2026-09-16T14:00:00',
    importance: 'high',
    previous: null,
    consensus: null,
    actual: null,
    unit: null,
    status: 'scheduled',
    relatedAssets: ['XAU/USD'],
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('CalendarStore.upsertMany - idempotent D1 upsert', () => {
  it('inserting the same event twice (same id) produces exactly one row - duplicate prevention', async () => {
    const { db, events } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.upsertMany([makeEvent()]);
    await store.upsertMany([makeEvent()]);

    expect(events.size).toBe(1);
  });

  it('re-ingesting with an updated title overwrites the metadata (schedule corrections apply)', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.upsertMany([makeEvent({ title: 'FOMC Interest Rate Decision' })]);
    await store.upsertMany([makeEvent({ title: 'FOMC Interest Rate Decision (Corrected)' })]);

    const [row] = await store.query({});
    expect(row?.title).toBe('FOMC Interest Rate Decision (Corrected)');
  });

  it('preserves an existing good actual value when a later ingestion supplies null - never overwrites known data with absence', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.upsertMany([makeEvent({ actual: 2.9, previous: 3.1, consensus: 2.8 })]);
    await store.upsertMany([makeEvent({ actual: null, previous: null, consensus: null })]); // e.g. a schedule-only re-sync

    const [row] = await store.query({});
    expect(row?.actual).toBe(2.9);
    expect(row?.previous).toBe(3.1);
    expect(row?.consensus).toBe(2.8);
  });

  it('a later ingestion with a genuinely new actual value DOES update it (not stuck forever once set)', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.upsertMany([makeEvent({ actual: null })]);
    await store.upsertMany([makeEvent({ actual: 3.0 })]);

    const [row] = await store.query({});
    expect(row?.actual).toBe(3.0);
  });

  it('two different events (different ids) both persist independently', async () => {
    const { db, events } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.upsertMany([makeEvent(), makeEvent({ id: 'curated_official:cpi-2026-09', sourceEventId: 'cpi-2026-09', title: 'US CPI' })]);

    expect(events.size).toBe(2);
  });

  it('an empty batch is a safe no-op', async () => {
    const { db, events } = createFakeCalendarD1();
    const store = new CalendarStore(db);
    await store.upsertMany([]);
    expect(events.size).toBe(0);
  });
});

describe('CalendarStore.query - API filters', () => {
  async function seeded() {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);
    await store.upsertMany([
      makeEvent({ id: 'a:1', sourceEventId: '1', country: 'US', currency: 'USD', category: 'monetary_policy', importance: 'high', eventTimeUtc: Date.UTC(2026, 8, 16) }),
      makeEvent({ id: 'a:2', sourceEventId: '2', country: 'EU', currency: 'EUR', category: 'monetary_policy', importance: 'high', eventTimeUtc: Date.UTC(2026, 9, 29) }),
      makeEvent({ id: 'a:3', sourceEventId: '3', country: 'US', currency: 'USD', category: 'inflation', importance: 'medium', eventTimeUtc: Date.UTC(2026, 8, 17) }),
    ]);
    return store;
  }

  it('filters by country', async () => {
    const store = await seeded();
    const rows = await store.query({ country: 'EU' });
    expect(rows.map((r) => r.id)).toEqual(['a:2']);
  });

  it('filters by currency', async () => {
    const store = await seeded();
    const rows = await store.query({ currency: 'USD' });
    expect(rows.map((r) => r.id).sort()).toEqual(['a:1', 'a:3']);
  });

  it('filters by importance', async () => {
    const store = await seeded();
    const rows = await store.query({ importance: 'medium' });
    expect(rows.map((r) => r.id)).toEqual(['a:3']);
  });

  it('filters by category', async () => {
    const store = await seeded();
    const rows = await store.query({ category: 'inflation' });
    expect(rows.map((r) => r.id)).toEqual(['a:3']);
  });

  it('filters by an exact date (UTC day bounds)', async () => {
    const store = await seeded();
    const rows = await store.query({ date: '2026-09-16' });
    expect(rows.map((r) => r.id)).toEqual(['a:1']);
  });

  it('filters by a from/to range', async () => {
    const store = await seeded();
    const rows = await store.query({ from: '2026-09-16', to: '2026-09-17' });
    expect(rows.map((r) => r.id).sort()).toEqual(['a:1', 'a:3']);
  });

  it('combines multiple filters (AND semantics)', async () => {
    const store = await seeded();
    const rows = await store.query({ country: 'US', importance: 'high' });
    expect(rows.map((r) => r.id)).toEqual(['a:1']);
  });

  it('no filters returns everything, ordered by time ascending', async () => {
    const store = await seeded();
    const rows = await store.query({});
    expect(rows.map((r) => r.id)).toEqual(['a:1', 'a:3', 'a:2']);
  });

  it('a filter matching nothing returns an honest empty array - empty calendar', async () => {
    const store = await seeded();
    const rows = await store.query({ country: 'JP' });
    expect(rows).toEqual([]);
  });
});

describe('CalendarStore source state - failure preserves known data', () => {
  it('recordSourceFailure does not clear a previously-recorded success timestamp', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.recordSourceSuccess('curated_official', 5, 1000);
    await store.recordSourceFailure('curated_official', 'network blip', 2000);

    const state = await store.sourceState('curated_official');
    expect(state?.lastSuccessAt).toBe(1000); // preserved - the last GOOD ingestion is still known
    expect(state?.lastFailureAt).toBe(2000);
    expect(state?.lastErrorMessage).toBe('network blip');
  });

  it('a subsequent success clears the error message but keeps updating success/count', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);

    await store.recordSourceFailure('fmp', 'boom', 1000);
    await store.recordSourceSuccess('fmp', 12, 2000);

    const state = await store.sourceState('fmp');
    expect(state?.lastSuccessAt).toBe(2000);
    expect(state?.lastErrorMessage).toBeNull();
    expect(state?.lastEventCount).toBe(12);
  });

  it('allSourceStates lists every recorded source', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);
    await store.recordSourceSuccess('curated_official', 40, 1000);
    await store.recordSourceFailure('fmp', 'not configured', 1000);

    const states = await store.allSourceStates();
    expect(states.map((s) => s.source).sort()).toEqual(['curated_official', 'fmp']);
  });

  it('an unknown source returns null, not a fabricated empty state', async () => {
    const { db } = createFakeCalendarD1();
    const store = new CalendarStore(db);
    expect(await store.sourceState('nonexistent')).toBeNull();
  });
});
