import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarketStreamRoom } from '../src/ws/market-stream-do';
import type { SymbolRow } from '../src/symbols/symbol-catalog';
import type { Env } from '../src/types';
import { createFakeKv } from './fakes';

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
  category: 'metals',
  enabled: 1,
  featured: 1,
  sort_order: 1,
  twelve_data_symbol: 'XAU/USD',
  alpaca_symbol: null,
  default_timeframe: 'm1',
  cache_ttl_seconds: null,
  updated_at: 0,
};
const AAPL: SymbolRow = { ...XAU, symbol: 'AAPL', category: 'us_equity', twelve_data_symbol: 'AAPL' };

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
    MKR_CONFIG: {} as never,
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
