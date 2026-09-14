import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionPolicy } from '../src/market/session-policy';
import { MarketStreamRoom } from '../src/ws/market-stream-do';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

// XAU/USD's category is 'gold', a `continuous` policy (Task 5) - this
// constant reproduces that resolution for tests that seed the aggregator
// directly (bypassing handleUpstreamMessage, which resolves the real
// policy from the symbol's D1 category itself).
const CONTINUOUS: SessionPolicy = { kind: 'continuous', timezone: 'UTC' };

// Cloudflare Workers exposes `WebSocket.READY_STATE_OPEN` as a runtime
// static; plain Node's global `WebSocket` does not define it. Since these
// tests run under `environment: 'node'` (vitest.config.ts) rather than the
// full Workers runtime, this stubs just that one constant so the
// connected-upstream branches in alarm()/handleUpstreamMessage are
// reachable - every other WebSocket usage here is a plain fake object, not
// a real socket.
beforeAll(() => {
  (WebSocket as unknown as { READY_STATE_OPEN: number }).READY_STATE_OPEN = 1;
});

const XAU: SymbolRow = {
  symbol: 'XAU/USD',
  display_name: 'Gold',
  category: 'gold', // matches schema.sql's real category value for XAU/USD - see session-policy.ts, category drives policy selection
  enabled: 1,
  featured: 1,
  sort_order: 1,
  twelve_data_symbol: 'XAU/USD',
  alpaca_symbol: null,
  default_timeframe: 'm1',
  cache_ttl_seconds: null,
  updated_at: 0,
};
const AAPL: SymbolRow = { ...XAU, symbol: 'AAPL', category: 'us_stock', twelve_data_symbol: 'AAPL' }; // 'us_stock' matches schema.sql's real category value

function fakeD1(rows: SymbolRow[]): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rows, success: true, meta: {} };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MKR_CONFIG: createFakeKv(),
    MKR_CACHE: createFakeKv(),
    MKR_DB: fakeD1([XAU, AAPL]),
    MARKET_STREAM: {} as never,
    RATE_LIMITER: {} as never,
    MARKET_PRIMARY_PROVIDER: 'twelve_data',
    MARKET_SECONDARY_PROVIDER: 'alpaca',
    MARKET_SECONDARY_ENABLED: 'false',
    CACHE_QUOTE_TTL_SECONDS: '60',
    CACHE_CANDLE_INTRADAY_TTL_SECONDS: '60',
    CACHE_CANDLE_DAILY_TTL_SECONDS: '600',
    CACHE_STATUS_TTL_SECONDS: '60',
    STALE_THRESHOLD_SECONDS: '90',
    RATE_LIMIT_PUBLIC_PER_MINUTE: '60',
    RATE_LIMIT_ADMIN_PER_MINUTE: '120',
    RATE_LIMIT_WS_MAX_CONNECTIONS: '500',
    ADMIN_WEB_ORIGIN: 'https://mkr-admin.pages.dev',
    // TWELVE_DATA_API_KEY intentionally left unset - connectUpstream() then
    // no-ops immediately ("no key configured - stream simply stays empty,
    // never fabricated"), which lets every ref-counting/lifecycle behavior
    // below be tested deterministically without a real upstream WebSocket.
    ...overrides,
  };
}

function fakeState() {
  const alarms: number[] = [];
  return {
    storage: {
      setAlarm: vi.fn(async (time: number) => {
        alarms.push(time);
      }),
      getAlarm: vi.fn(async () => null),
    },
    alarms,
  } as unknown as { storage: DurableObjectState['storage']; alarms: number[] };
}

function fakeSocket(): WebSocket {
  return {} as unknown as WebSocket;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoomInternals = any;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MarketStreamRoom - Market Pool Core (Phase 1/2/3 direct DO tests)', () => {
  describe('viewer ref counting', () => {
    it('1 client subscribing creates exactly 1 upstream subscription', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      await room.subscribeClient(fakeSocket(), ['XAU/USD']);
      expect([...room.upstreamSubscribedProviderSymbols]).toEqual(['XAU/USD']);
    });

    it('100 clients subscribing to the same symbol still create exactly 1 upstream subscription', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      for (let i = 0; i < 100; i++) await room.subscribeClient(fakeSocket(), ['XAU/USD']);
      expect(room.upstreamSubscribedProviderSymbols.size).toBe(1);
      expect(room.symbolSubscribers.get('XAU/USD').size).toBe(100);
    });

    it('a duplicate subscribe from the same socket does not double-count its ref', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);
      await room.subscribeClient(socket, ['XAU/USD']);
      expect(room.symbolSubscribers.get('XAU/USD').size).toBe(1);
    });

    it('an unknown/unsupported symbol is silently skipped - never creates an upstream subscription', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      await room.subscribeClient(fakeSocket(), ['NOT-A-REAL-SYMBOL']);
      expect(room.upstreamSubscribedProviderSymbols.size).toBe(0);
    });
  });

  describe('idle grace (Decision 2)', () => {
    it('the last viewer leaving schedules idle grace instead of unsubscribing immediately', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);
      room.unsubscribeClientFromSymbol(socket, 'XAU/USD');

      expect(room.pendingIdleUnsubscribe.has('XAU/USD')).toBe(true);
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(true); // still subscribed - grace not expired
    });

    it('sweepIdleUnsubscribes only unsubscribes once the grace period has actually expired', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);
      room.unsubscribeClientFromSymbol(socket, 'XAU/USD');

      room.sweepIdleUnsubscribes(); // grace not expired yet
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(true);

      room.pendingIdleUnsubscribe.set('XAU/USD', Date.now() - 1); // simulate grace having expired
      await room.sweepIdleUnsubscribes();
      await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget unsubscribe settle
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(false);
    });

    it('a viewer resubscribing during the grace window cancels the pending unsubscribe', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);
      room.unsubscribeClientFromSymbol(socket, 'XAU/USD');
      expect(room.pendingIdleUnsubscribe.has('XAU/USD')).toBe(true);

      await room.subscribeClient(socket, ['XAU/USD']);
      expect(room.pendingIdleUnsubscribe.has('XAU/USD')).toBe(false);
    });
  });

  describe('alert refs are independent of viewer refs (Decision 3)', () => {
    async function seedAlertIndex(env: Env, bySymbol: Record<string, unknown[]>) {
      await env.MKR_CACHE.put('alerts:index', JSON.stringify({ bySymbol, builtAt: Date.now() }));
    }

    it('an alert-only symbol (zero viewers) still gets an upstream subscription after syncAlertRefs', async () => {
      const env = makeEnv();
      await seedAlertIndex(env, { 'XAU/USD': [{ id: 'a1' }] });
      const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;

      await room.syncAlertRefs();

      expect(room.alertRefCounts.get('XAU/USD')).toBe(1);
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(true);
      expect(room.symbolSubscribers.get('XAU/USD')?.size ?? 0).toBe(0); // still zero viewers
    });

    it('the last viewer leaving does NOT trigger idle grace while an alert ref remains', async () => {
      const env = makeEnv();
      await seedAlertIndex(env, { 'XAU/USD': [{ id: 'a1' }] });
      const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
      await room.syncAlertRefs();

      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);
      room.unsubscribeClientFromSymbol(socket, 'XAU/USD');

      expect(room.pendingIdleUnsubscribe.has('XAU/USD')).toBe(false); // alert ref keeps totalRefs > 0
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(true);
    });

    it('removing the last alert ref (with zero viewers) schedules idle grace, and the sweep then unsubscribes', async () => {
      const env = makeEnv();
      await seedAlertIndex(env, { 'XAU/USD': [{ id: 'a1' }] });
      const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
      await room.syncAlertRefs();
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(true);

      await seedAlertIndex(env, {}); // alert deleted/disabled
      await room.syncAlertRefs();

      expect(room.alertRefCounts.has('XAU/USD')).toBe(false);
      expect(room.pendingIdleUnsubscribe.has('XAU/USD')).toBe(true);

      room.pendingIdleUnsubscribe.set('XAU/USD', Date.now() - 1);
      await room.sweepIdleUnsubscribes();
      await new Promise((r) => setTimeout(r, 0));
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(false);
    });

    it('combined refs: alertRefCounts tracks the number of enabled alerts on a symbol, not just presence', async () => {
      const env = makeEnv();
      await seedAlertIndex(env, { 'XAU/USD': [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] });
      const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
      await room.syncAlertRefs();
      expect(room.alertRefCounts.get('XAU/USD')).toBe(3);
    });
  });

  describe('canonical quote state (Decision 5) - fed by every tick regardless of viewer/alert-only status', () => {
    it('a tick for an alert-only symbol (zero viewers) still updates quoteState', () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };

      room.handleUpstreamMessage(JSON.stringify({ event: 'price', symbol: 'XAU/USD', price: 3451.2 }));

      expect(room.quoteState.get('XAU/USD')?.price).toBe(3451.2);
    });

    it('a malformed upstream frame is ignored, not thrown', () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU], fetchedAt: Date.now() };
      expect(() => room.handleUpstreamMessage('not json')).not.toThrow();
      expect(() => room.handleUpstreamMessage(JSON.stringify({ event: 'heartbeat' }))).not.toThrow();
    });
  });

  describe('poolStatusSnapshot (Phase 11 observability)', () => {
    it('reports hot/idle_grace/cold lifecycle correctly', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);

      let snapshot = room.poolStatusSnapshot();
      expect(snapshot.symbols.find((s: { symbol: string }) => s.symbol === 'XAU/USD').lifecycle).toBe('hot');

      room.unsubscribeClientFromSymbol(socket, 'XAU/USD');
      snapshot = room.poolStatusSnapshot();
      expect(snapshot.symbols.find((s: { symbol: string }) => s.symbol === 'XAU/USD').lifecycle).toBe('idle_grace');
    });
  });

  describe('reconnect backoff with jitter (Phase 2)', () => {
    it('does not schedule a reconnect when nobody needs data (zero viewer refs, zero alert refs)', () => {
      const state = fakeState();
      const room = new MarketStreamRoom(state as never, makeEnv()) as RoomInternals;
      room.scheduleReconnect();
      expect(state.storage.setAlarm).not.toHaveBeenCalled();
    });

    it('schedules a jittered reconnect, bounded by the exponential backoff ceiling, when refs exist', async () => {
      const state = fakeState();
      const env = makeEnv();
      const room = new MarketStreamRoom(state as never, env) as RoomInternals;
      await room.subscribeClient(fakeSocket(), ['XAU/USD']);

      const before = Date.now();
      room.scheduleReconnect();

      expect(state.storage.setAlarm).toHaveBeenCalledTimes(1);
      const scheduledAt = state.alarms[0]!;
      const delayMs = scheduledAt - before;
      expect(delayMs).toBeGreaterThan(0);
      expect(delayMs).toBeLessThanOrEqual(30_000); // MAX_BACKOFF_SECONDS ceiling
    });
  });

  describe('alarm() - heartbeat + idle-grace sweep while connected', () => {
    it('sends a heartbeat, sweeps expired idle-grace entries, and reschedules itself', async () => {
      const state = fakeState();
      const room = new MarketStreamRoom(state as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      await room.subscribeClient(socket, ['XAU/USD']);
      room.unsubscribeClientFromSymbol(socket, 'XAU/USD');
      room.pendingIdleUnsubscribe.set('XAU/USD', Date.now() - 1); // force-expire the grace

      const send = vi.fn();
      room.upstream = { readyState: 1, send, close: vi.fn() };

      await room.alarm();
      await new Promise((r) => setTimeout(r, 0));

      expect(send).toHaveBeenCalledWith(JSON.stringify({ action: 'heartbeat' }));
      expect(room.upstreamSubscribedProviderSymbols.has('XAU/USD')).toBe(false);
      expect(state.storage.setAlarm).toHaveBeenCalled();
    });
  });

  describe('internal HTTP routes (/sync-alert-refs, /pool-status) - not reachable from the public WS route', () => {
    it('/sync-alert-refs syncs alert refs and returns 204', async () => {
      const env = makeEnv();
      await env.MKR_CACHE.put('alerts:index', JSON.stringify({ bySymbol: { 'XAU/USD': [{ id: 'a1' }] }, builtAt: Date.now() }));
      const room = new MarketStreamRoom(fakeState() as never, env);

      const response = await room.fetch(new Request('https://internal/sync-alert-refs', { method: 'POST' }));

      expect(response.status).toBe(204);
      expect((room as RoomInternals).alertRefCounts.get('XAU/USD')).toBe(1);
    });

    it('/pool-status returns a JSON snapshot', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv());
      const response = await room.fetch(new Request('https://internal/pool-status'));
      const body = (await response.json()) as { connectedClients: number; symbols: unknown[] };

      expect(response.headers.get('content-type')).toContain('application/json');
      expect(body.connectedClients).toBe(0);
      expect(Array.isArray(body.symbols)).toBe(true);
    });

    it('rejects a non-WebSocket, non-internal request with 400', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv());
      const response = await room.fetch(new Request('https://internal/'));
      expect(response.status).toBe(400);
    });
  });
});

const M1_BUCKET = Date.UTC(2026, 8, 14, 10, 23, 0);

describe('MarketStreamRoom - server-side candle aggregation + WS Protocol V2 (Task 2)', () => {
  describe('subscribeCandles - snapshot semantics (Decision 11)', () => {
    it('sends an immediate snapshot with both fields null when no data exists yet (no API key configured)', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      const sent: string[] = [];
      socket.send = (payload: string) => sent.push(payload);

      await room.subscribeCandles(socket, ['XAU/USD'], ['m1']);

      expect(sent).toHaveLength(1);
      const envelope = JSON.parse(sent[0]!);
      expect(envelope).toMatchObject({ v: 2, type: 'snapshot', symbol: 'XAU/USD', timeframe: 'm1' });
      expect(envelope.data).toEqual({ current: null, lastClosed: null });
    });

    it('the snapshot reflects live state already in the aggregator, not a stale value', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
      room.candleAggregator.ingest('XAU/USD', 'm1', 3450, M1_BUCKET + 1000, 'twelve_data', CONTINUOUS);

      const socket = fakeSocket();
      const sent: string[] = [];
      socket.send = (payload: string) => sent.push(payload);
      await room.subscribeCandles(socket, ['XAU/USD'], ['m1']);

      const envelope = JSON.parse(sent[0]!);
      expect(envelope.data.current).toMatchObject({ close: 3450 });
    });
  });

  describe('candle demand and tick-driven broadcast', () => {
    it('a tick for a symbol with candle demand broadcasts a v2 candle message only to candle subscribers, not all viewers', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };

      const viewerOnlySocket = fakeSocket();
      const viewerSent: string[] = [];
      viewerOnlySocket.send = (p: string) => viewerSent.push(p);
      await room.subscribeClient(viewerOnlySocket, ['XAU/USD']);

      const candleSocket = fakeSocket();
      const candleSent: string[] = [];
      candleSocket.send = (p: string) => candleSent.push(p);
      await room.subscribeCandles(candleSocket, ['XAU/USD'], ['m1']);
      candleSent.length = 0; // drop the initial snapshot

      room.handleUpstreamMessage(JSON.stringify({ event: 'price', symbol: 'XAU/USD', price: 3451 }));

      expect(viewerSent.some((p) => JSON.parse(p).v === 2)).toBe(false); // viewer only ever gets V1 tick frames
      expect(candleSent).toHaveLength(1);
      const envelope = JSON.parse(candleSent[0]!);
      expect(envelope).toMatchObject({ v: 2, type: 'candle', symbol: 'XAU/USD', timeframe: 'm1' });
    });

    it('a tick for a symbol with NO candle demand does no aggregation work at all (candleAggregator stays empty)', () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };

      room.handleUpstreamMessage(JSON.stringify({ event: 'price', symbol: 'AAPL', price: 200 }));

      expect(room.candleAggregator.getCurrent('AAPL', 'm1', 'twelve_data')).toBeNull();
    });

    it('a bucket rollover broadcasts BOTH the closed candle and the new current candle', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
      // handleUpstreamMessage timestamps every tick with Date.now() internally
      // (the upstream frame carries no timestamp field) - seed a bucket far
      // enough in the past that the next real tick deterministically rolls it over.
      const past = Date.now() - 5 * 60_000;
      room.candleAggregator.ingest('XAU/USD', 'm1', 3450, past, 'twelve_data', CONTINUOUS);

      const socket = fakeSocket();
      const sent: string[] = [];
      socket.send = (p: string) => sent.push(p);
      await room.subscribeCandles(socket, ['XAU/USD'], ['m1']);
      sent.length = 0;

      room.handleUpstreamMessage(JSON.stringify({ event: 'price', symbol: 'XAU/USD', price: 3460 }));

      const messages = sent.map((p) => JSON.parse(p));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ type: 'candle', data: { close: 3450, closed: true } });
      expect(messages[1]).toMatchObject({ type: 'candle', data: { open: 3460, closed: false } });
    });
  });

  describe('cleanup lifecycle (Decision 15) - unsubscribe and disconnect both release candle state', () => {
    it('unsubscribeCandles removes the socket and clears aggregator state once no subscriber remains', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
      const socket = fakeSocket();
      socket.send = () => {};
      await room.subscribeCandles(socket, ['XAU/USD'], ['m1']);
      room.candleAggregator.ingest('XAU/USD', 'm1', 3450, Date.now(), 'twelve_data', CONTINUOUS);

      room.unsubscribeCandles(socket, ['XAU/USD'], ['m1']);

      expect(room.candleSubscribers.has('XAU/USD:m1')).toBe(false);
      expect(room.candleAggregator.getCurrent('XAU/USD', 'm1', 'twelve_data')).toBeNull();
    });

    it('a disconnecting client (removeClient) also releases its candle subscriptions', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
      const socket = fakeSocket();
      socket.send = () => {};
      await room.subscribeCandles(socket, ['XAU/USD'], ['m1']);

      room.removeClient(socket);

      expect(room.candleSubscribers.has('XAU/USD:m1')).toBe(false);
      expect(room.candleDemand.has('XAU/USD')).toBe(false);
    });

    it('one socket unsubscribing does not affect another socket still subscribed to the same (symbol, timeframe)', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
      const a = fakeSocket();
      a.send = () => {};
      const b = fakeSocket();
      b.send = () => {};
      await room.subscribeCandles(a, ['XAU/USD'], ['m1']);
      await room.subscribeCandles(b, ['XAU/USD'], ['m1']);

      room.unsubscribeCandles(a, ['XAU/USD'], ['m1']);

      expect(room.candleSubscribers.get('XAU/USD:m1').has(b)).toBe(true);
    });
  });

  describe('backward compatibility - V1 clients are unaffected', () => {
    it('a subscribe message without "timeframes" does no candle work at all', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      socket.send = () => {};

      await room.handleClientMessage(socket, JSON.stringify({ action: 'subscribe', symbols: ['XAU/USD'] }));

      expect(room.candleDemand.size).toBe(0);
      expect(room.candleSubscribers.size).toBe(0);
    });

    it('handleClientMessage tolerates a malformed "timeframes" field (not an array) without throwing', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      const socket = fakeSocket();
      socket.send = () => {};

      await expect(
        room.handleClientMessage(socket, JSON.stringify({ action: 'subscribe', symbols: ['XAU/USD'], timeframes: 'm1' })),
      ).resolves.toBeUndefined();
      expect(room.candleDemand.size).toBe(0); // 'm1' as a bare string, not an array, is dropped by validTimeframes
    });
  });

  describe('historical reconciliation (Decision 8) - single-flight, no REST-per-tick', () => {
    it('concurrent candle subscriptions to the same (symbol, timeframe) coalesce into ONE REST call', async () => {
      const currentBucketStart = M1_BUCKET;
      const fetchSpy = vi.fn(async () =>
        new Response(
          JSON.stringify({
            values: [
              { datetime: new Date(currentBucketStart).toISOString(), open: '150', high: '151', low: '149', close: '150.5', volume: '1000' },
              { datetime: new Date(currentBucketStart - 60_000).toISOString(), open: '148', high: '150', low: '147', close: '150', volume: '900' },
            ],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchSpy);

      const env = makeEnv({ TWELVE_DATA_API_KEY: 'fake-key-not-real', MKR_CONFIG: createFakeKv() });
      const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };

      const socketA = fakeSocket();
      socketA.send = () => {};
      const socketB = fakeSocket();
      socketB.send = () => {};

      await Promise.all([room.subscribeCandles(socketA, ['AAPL'], ['m1']), room.subscribeCandles(socketB, ['AAPL'], ['m1'])]);

      expect(fetchSpy).toHaveBeenCalledTimes(1); // single-flight coalesced via cachedFetch, not one call per subscriber
      expect(room.candleAggregator.getCurrent('AAPL', 'm1', 'twelve_data')?.open).toBe(150);
    });

    it('a normal tick never triggers a REST call - no per-tick request explosion', () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
      room.candleDemand.set('XAU/USD', new Set(['m1']));
      room.candleSubscribers.set('XAU/USD:m1', new Set());

      for (let i = 0; i < 50; i++) room.handleUpstreamMessage(JSON.stringify({ event: 'price', symbol: 'XAU/USD', price: 3450 + i }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reconciliation failure (no provider available) does not throw - subscribeCandles still completes and sends a snapshot', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals; // no TWELVE_DATA_API_KEY
      const socket = fakeSocket();
      const sent: string[] = [];
      socket.send = (p: string) => sent.push(p);

      await room.subscribeCandles(socket, ['AAPL'], ['m1']);

      expect(sent).toHaveLength(1);
    });

    describe('Task 5 - reconciliation compares against the session-aware bucket, not raw UTC', () => {
      // "Now" fixed to 2026-09-14T14:00:00Z (10:00 EDT - mid NYSE regular
      // session). Exchange-local midnight for AAPL (us_stock) on this date
      // is 2026-09-14T04:00:00Z.
      const NOW = Date.UTC(2026, 8, 14, 14, 0, 0);

      afterEach(() => vi.useRealTimers());

      it("d1 reconciliation seeds CURRENT when the provider's most recent candle IS today's exchange-local session", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        // Twelve Data's real datetime format (space-separated, no 'Z') is
        // parsed via a pre-existing, unrelated `Date.parse` call this task
        // does not touch - using an unambiguous ISO 'Z' string here isolates
        // this test to the comparison logic this task DOES change, not that
        // parser's own timezone-interpretation behavior (a separately
        // documented, pre-existing characteristic - see the Task 2 ADR).
        // Exchange-local midnight for AAPL on 2026-09-14 is 2026-09-14T04:00:00Z.
        vi.stubGlobal(
          'fetch',
          vi.fn(async () =>
            new Response(JSON.stringify({ values: [{ datetime: '2026-09-14T04:00:00.000Z', open: '229', high: '231', low: '228', close: '230', volume: '1000' }] }), {
              status: 200,
            }),
          ),
        );
        const env = makeEnv({ TWELVE_DATA_API_KEY: 'fake-key-not-real', MKR_CONFIG: createFakeKv() });
        const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
        room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
        const socket = fakeSocket();
        socket.send = () => {};
        await room.subscribeCandles(socket, ['AAPL'], ['d1']);

        const current = room.candleAggregator.getCurrent('AAPL', 'd1', 'twelve_data');
        expect(current).not.toBeNull(); // seeded as the LIVE bucket, not lastClosed
        expect(current?.close).toBe(230);
      });

      it("d1 reconciliation seeds lastClosed (NOT current) for a candle that is still yesterday in exchange-local time even though it's already 'today' in UTC - the exact bug this task fixes", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        // 2026-09-14T02:00:00Z is UTC-"today" but EDT-"yesterday" (Sept 13, 22:00 EDT).
        // Under the OLD UTC-only comparison (`mostRecent.timestamp >= bucketStart(now,'d1')`,
        // UTC day start = Sept 14 00:00 UTC), 02:00 UTC >= 00:00 UTC would have been
        // wrongly treated as "still today's bucket" and seeded as CURRENT.
        vi.stubGlobal(
          'fetch',
          vi.fn(async () =>
            new Response(JSON.stringify({ values: [{ datetime: '2026-09-14T02:00:00.000Z', open: '227', high: '228', low: '226', close: '227.5', volume: '900' }] }), {
              status: 200,
            }),
          ),
        );
        const env = makeEnv({ TWELVE_DATA_API_KEY: 'fake-key-not-real', MKR_CONFIG: createFakeKv() });
        const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
        room.symbolRowsCache = { rows: [XAU, AAPL], fetchedAt: Date.now() };
        const socket = fakeSocket();
        socket.send = () => {};
        await room.subscribeCandles(socket, ['AAPL'], ['d1']);

        expect(room.candleAggregator.getCurrent('AAPL', 'd1', 'twelve_data')).toBeNull(); // correctly NOT seeded as current
        expect(room.candleAggregator.getLastClosed('AAPL', 'd1')?.close).toBe(227.5); // correctly seeded as the prior (closed) session instead
      });
    });
  });

  describe('does not disturb existing pooling/alert-only behavior (Decision 12/13)', () => {
    it('100 clients subscribing to candles for the same symbol still share exactly 1 upstream tick subscription', async () => {
      const room = new MarketStreamRoom(fakeState() as never, makeEnv()) as RoomInternals;
      for (let i = 0; i < 100; i++) {
        const socket = fakeSocket();
        socket.send = () => {};
        await room.subscribeClient(socket, ['XAU/USD']);
        await room.subscribeCandles(socket, ['XAU/USD'], ['m1']);
      }
      expect(room.upstreamSubscribedProviderSymbols.size).toBe(1);
    });

    it('an alert-only symbol (zero viewers) still records ticks into quoteState even with candle demand present', async () => {
      const env = makeEnv();
      await env.MKR_CACHE.put('alerts:index', JSON.stringify({ bySymbol: { 'XAU/USD': [{ id: 'a1' }] }, builtAt: Date.now() }));
      const room = new MarketStreamRoom(fakeState() as never, env) as RoomInternals;
      await room.syncAlertRefs();
      room.candleDemand.set('XAU/USD', new Set(['m1']));
      room.candleSubscribers.set('XAU/USD:m1', new Set());

      room.handleUpstreamMessage(JSON.stringify({ event: 'price', symbol: 'XAU/USD', price: 3451 }));

      expect(room.quoteState.get('XAU/USD')?.price).toBe(3451);
      expect(room.candleAggregator.getCurrent('XAU/USD', 'm1', 'twelve_data')?.close).toBe(3451);
    });
  });
});
