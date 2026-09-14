import { evaluateTick } from '../alerts/alert-engine';
import { getAlertIndex } from '../alerts/alert-index';
import { cachedFetch, cacheKey } from '../cache/cache-service';
import { getConfig } from '../config/config-service';
import { logError, logInfo } from '../logging';
import { CandleAggregator, type RealtimeCandle } from '../market/candle-aggregator';
import { candleTtlFor } from '../market/normalize';
import { managerFor } from '../market/provider-manager-factory';
import { resolveBucketStart, sessionPolicyForCategory, type SessionPolicy } from '../market/session-policy';
import { catalogFor } from '../symbols/symbol-catalog';
import { mapSymbolFromRows } from '../symbols/symbol-mapper';
import type { Env, MkrTimeframe, ProviderId } from '../types';
import { candleMessage, snapshotMessage, validTimeframes } from './protocol-v2';

interface NormalizedTick {
  symbol: string;
  price: number;
  timestamp: number;
  source: 'twelve_data';
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const SYMBOL_CACHE_TTL_MS = 5 * 60_000;
const MAX_BACKOFF_SECONDS = 30;
// Decision 2: don't drop the upstream subscription the instant refs hit
// zero - a Flutter app backgrounding/foregrounding, or a screen navigation
// that briefly unsubscribes/resubscribes, would otherwise cause needless
// upstream churn. 45s sits in the spec's 30-60s idle-grace range.
const IDLE_GRACE_MS = 45_000;

const ROOM_ID = 'global';

/**
 * ONE Durable Object instance ("global", see [ROOM_ID]) holds the single
 * shared upstream Twelve Data WebSocket connection and fans normalized
 * ticks out to every connected Flutter client - the server-side
 * counterpart of the "Flutter Client A/B/C -> MKR WS Gateway -> Twelve
 * Data WS" diagram in the Phase 2 spec. A Durable Object is the correct
 * Cloudflare-native primitive here because a plain Worker has no
 * persistent state across requests/isolates; this is the one place in the
 * backend that genuinely needs it (see docs/MKR-PHASE2-ARCHITECTURE.md).
 *
 * Market Pool Core (see docs/architecture/MKR_MARKET_DATA_ARCHITECTURE_DECISIONS.md,
 * ADR-001 Decisions 1-3): this room is the canonical live market state for
 * every symbol it subscribes to. Two independent reference sources keep a
 * symbol's upstream subscription alive - `symbolSubscribers` (viewer refs,
 * one per connected WebSocket client) and `alertRefCounts` (alert refs,
 * synced from the Alert Engine's KV index once a minute - see
 * syncAlertRefs/triggerAlertRefSync). A symbol stays subscribed as long as
 * EITHER source holds a ref, so an alert continues monitoring its symbol
 * even with every Flutter app closed - Decision 3's core requirement.
 *
 * One room today; if a single Twelve Data WS connection's symbol-count
 * limit is ever a real constraint, sharding by symbol-set into multiple
 * rooms is a natural next step - not built now, to avoid overengineering.
 */
export class MarketStreamRoom {
  private clients = new Set<WebSocket>();
  private clientSubscriptions = new Map<WebSocket, Set<string>>(); // client -> MKR symbols
  private symbolSubscribers = new Map<string, Set<WebSocket>>(); // MKR symbol -> viewer refs

  /** MKR symbol -> count of enabled alerts targeting it (Decision 3's "alert refs"). */
  private alertRefCounts = new Map<string, number>();
  /** MKR symbol -> the time its idle grace expires, once total refs hit zero (Decision 2). */
  private pendingIdleUnsubscribe = new Map<string, number>();
  /** MKR symbol -> canonical last-known quote (Decision 5's "one tick feeds every consumer"). */
  private quoteState = new Map<string, NormalizedTick>();

  /** Task 2 - server-side canonical candle aggregation (WS Protocol V2). */
  private candleAggregator = new CandleAggregator();
  /** `${symbol}:${timeframe}` -> the sockets that asked for candle updates on that pair. */
  private candleSubscribers = new Map<string, Set<WebSocket>>();
  /** symbol -> the set of timeframes with at least one candle subscriber - only these are fed ticks (Decision 15: bounds memory to actual demand). */
  private candleDemand = new Map<string, Set<MkrTimeframe>>();

  private upstream: WebSocket | null = null;
  private upstreamSubscribedProviderSymbols = new Set<string>();
  private reconnectAttempt = 0;

  private symbolRowsCache: { rows: Awaited<ReturnType<ReturnType<typeof catalogFor>['all']>>; fetchedAt: number } | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal-only routes - never reachable from the public internet: the
    // public /api/mkr/market/stream route (ws-routes.ts) rejects any
    // non-WebSocket-upgrade request before it ever forwards to this DO, so
    // only server-side callers holding the MARKET_STREAM binding directly
    // (the cron's triggerAlertRefSync, and the admin pool-status route) can
    // reach these paths.
    if (url.pathname === '/sync-alert-refs') {
      await this.syncAlertRefs();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/pool-status') {
      return Response.json(this.poolStatusSnapshot());
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }

    const maxConnections = Number(this.env.RATE_LIMIT_WS_MAX_CONNECTIONS) || 500;
    if (this.clients.size >= maxConnections) {
      return new Response('Too many concurrent WebSocket connections', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.clients.add(server);
    this.clientSubscriptions.set(server, new Set());

    server.addEventListener('message', (event) => {
      void this.handleClientMessage(server, event.data);
    });
    server.addEventListener('close', () => this.removeClient(server));
    server.addEventListener('error', () => this.removeClient(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private removeClient(socket: WebSocket): void {
    const symbols = this.clientSubscriptions.get(socket) ?? new Set<string>();
    this.clientSubscriptions.delete(socket);
    this.clients.delete(socket);
    for (const symbol of symbols) this.unsubscribeClientFromSymbol(socket, symbol);

    for (const [key, subs] of this.candleSubscribers) {
      if (!subs.has(socket)) continue;
      subs.delete(socket);
      if (subs.size === 0) this.dropCandleDemand(key);
    }
  }

  private dropCandleDemand(key: string): void {
    this.candleSubscribers.delete(key);
    const separatorIndex = key.lastIndexOf(':');
    const symbol = key.slice(0, separatorIndex);
    const timeframe = key.slice(separatorIndex + 1) as MkrTimeframe;
    const demand = this.candleDemand.get(symbol);
    demand?.delete(timeframe);
    if (demand && demand.size === 0) this.candleDemand.delete(symbol);
    this.candleAggregator.clear(symbol, timeframe); // Decision 15 cleanup lifecycle - bounds memory to actual demand
  }

  private async handleClientMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let msg: { action?: string; symbols?: string[]; timeframes?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(msg.symbols)) return;
    const symbols = [...new Set(msg.symbols.map((s) => String(s).toUpperCase()))];
    // WS Protocol V2 (Task 2) - `timeframes` is an optional additive field on
    // the SAME subscribe/unsubscribe action V1 clients already send; a V1
    // client that never sends it simply gets no candle behavior, unchanged.
    const timeframes = validTimeframes(msg.timeframes);

    if (msg.action === 'subscribe') {
      await this.subscribeClient(socket, symbols);
      if (timeframes.length > 0) await this.subscribeCandles(socket, symbols, timeframes);
    } else if (msg.action === 'unsubscribe') {
      for (const symbol of symbols) this.unsubscribeClientFromSymbol(socket, symbol);
      if (timeframes.length > 0) this.unsubscribeCandles(socket, symbols, timeframes);
    }
  }

  /**
   * Registers candle demand and sends an immediate snapshot (Decision 11) -
   * never creates a new upstream tick subscription by itself (Decision 12):
   * candle aggregation only ever runs off ticks that `subscribeClient`
   * (viewer refs) or `syncAlertRefs` (alert refs) already caused to flow.
   * A client that asks for candles on a symbol with no viewer/alert ref
   * gets a snapshot (possibly reconciled from historical REST) but no
   * further live updates until some ref exists - a deliberate, documented
   * limitation matching that explicit constraint, not an oversight.
   */
  private async subscribeCandles(socket: WebSocket, symbols: string[], timeframes: MkrTimeframe[]): Promise<void> {
    for (const symbol of symbols) {
      const demand = this.candleDemand.get(symbol) ?? new Set<MkrTimeframe>();
      for (const timeframe of timeframes) {
        const key = `${symbol}:${timeframe}`;
        let subs = this.candleSubscribers.get(key);
        if (!subs) {
          subs = new Set();
          this.candleSubscribers.set(key, subs);
        }
        subs.add(socket);
        demand.add(timeframe);
      }
      this.candleDemand.set(symbol, demand);

      for (const timeframe of timeframes) {
        await this.reconcileIfNeeded(symbol, timeframe);
        const current = this.candleAggregator.getCurrent(symbol, timeframe, 'twelve_data');
        const lastClosed = this.candleAggregator.getLastClosed(symbol, timeframe);
        this.sendToSocket(socket, snapshotMessage(symbol, timeframe, { current, lastClosed }));
      }
    }
  }

  private unsubscribeCandles(socket: WebSocket, symbols: string[], timeframes: MkrTimeframe[]): void {
    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        const key = `${symbol}:${timeframe}`;
        const subs = this.candleSubscribers.get(key);
        if (!subs) continue;
        subs.delete(socket);
        if (subs.size === 0) this.dropCandleDemand(key);
      }
    }
  }

  /**
   * Decision 8 - seeds the aggregator from ONE historical REST call (via
   * the existing provider abstraction, KV-cached and single-flight
   * coalesced via [cachedFetch] - never a REST call per tick, never a
   * second provider-manager). No-op (and no REST call at all) once a live
   * bucket already exists for this (symbol, timeframe) - reconciliation
   * only ever runs on cold start for that pair, not on every subscribe.
   */
  private async reconcileIfNeeded(symbol: string, timeframe: MkrTimeframe): Promise<void> {
    if (this.candleAggregator.getCurrent(symbol, timeframe, 'twelve_data')) return;

    try {
      const config = await getConfig(this.env);
      const manager = await managerFor(this.env, config);
      const rows = await this.getSymbolRows();
      const symbolFor = (id: ProviderId) => mapSymbolFromRows(rows, symbol, id);
      const ttl = candleTtlFor(timeframe, config.cacheTtls);
      const policy = this.policyFor(rows, symbol);

      const { value: candles } = await cachedFetch(this.env.MKR_CACHE, cacheKey('candles', symbol, `${timeframe}:pool-seed`), ttl, async () => {
        const { result } = await manager.getCandles(symbol, timeframe, 2, symbolFor, 'P3'); // reconciliation/warm maintenance (Task 6)
        return result;
      });

      const mostRecent = candles[candles.length - 1];
      if (!mostRecent) return;

      // Task 5: which bucket "now" resolves to must use the SAME
      // session-aware policy the live tick path uses (resolveBucketStart),
      // not raw UTC - otherwise reconciliation could misjudge whether the
      // provider's most recent historical candle is still the live/open
      // bucket for a session-based asset (e.g. a UTC-day comparison could
      // wrongly treat a US-equity candle as "already closed" mid-session,
      // or vice versa).
      const now = Date.now();
      if (mostRecent.timestamp >= resolveBucketStart(now, timeframe, policy)) {
        this.candleAggregator.seed(symbol, timeframe, mostRecent, now);
        const secondMostRecent = candles[candles.length - 2];
        if (secondMostRecent) this.candleAggregator.seedLastClosed(symbol, timeframe, secondMostRecent, now);
      } else {
        this.candleAggregator.seedLastClosed(symbol, timeframe, mostRecent, now);
      }
      logInfo('candle reconciliation', { symbol, timeframe });
    } catch (err) {
      // Non-fatal: the client still gets a snapshot (both fields null) and
      // the aggregator seeds itself normally from the next live tick -
      // reconciliation only improves cold-start completeness, it is never
      // required for correctness.
      logError('candle reconciliation failed - continuing without seed', { symbol, timeframe, message: (err as Error).message });
    }
  }

  private broadcastCandle(subs: Set<WebSocket>, candle: RealtimeCandle): void {
    const payload = JSON.stringify(candleMessage(candle));
    for (const socket of subs) {
      try {
        socket.send(payload);
      } catch {
        this.removeClient(socket);
      }
    }
  }

  private sendToSocket(socket: WebSocket, envelope: unknown): void {
    try {
      socket.send(JSON.stringify(envelope));
    } catch {
      this.removeClient(socket);
    }
  }

  private async getSymbolRows() {
    if (this.symbolRowsCache && Date.now() - this.symbolRowsCache.fetchedAt < SYMBOL_CACHE_TTL_MS) {
      return this.symbolRowsCache.rows;
    }
    const rows = await catalogFor(this.env).all();
    this.symbolRowsCache = { rows, fetchedAt: Date.now() };
    return rows;
  }

  /** Task 5 - resolves the session policy for a symbol from its D1 `category` (schema.sql). Falls back to the `continuous`/UTC policy (unchanged pre-existing behavior) if the symbol row can't be found - never throws, never guesses a session that isn't evidenced. */
  private policyFor(rows: Awaited<ReturnType<ReturnType<typeof catalogFor>['all']>>, mkrSymbol: string): SessionPolicy {
    const row = rows.find((r) => r.symbol === mkrSymbol);
    return sessionPolicyForCategory(row?.category ?? 'other');
  }

  private async subscribeClient(socket: WebSocket, symbols: string[]): Promise<void> {
    const rows = await this.getSymbolRows();
    const clientSymbols = this.clientSubscriptions.get(socket) ?? new Set<string>();

    for (const symbol of symbols) {
      const providerSymbol = mapSymbolFromRows(rows, symbol, 'twelve_data');
      if (!providerSymbol) continue; // unsupported symbol - silently skip, never guess

      clientSymbols.add(symbol);
      let subscribers = this.symbolSubscribers.get(symbol);
      if (!subscribers) {
        subscribers = new Set();
        this.symbolSubscribers.set(symbol, subscribers);
      }
      const isNewSymbol = subscribers.size === 0;
      subscribers.add(socket);
      this.pendingIdleUnsubscribe.delete(symbol); // a viewer arrived - cancel any pending idle-grace unsubscribe

      if (isNewSymbol) await this.ensureUpstreamSubscribed(providerSymbol);
    }
    this.clientSubscriptions.set(socket, clientSymbols);
  }

  private unsubscribeClientFromSymbol(socket: WebSocket, symbol: string): void {
    this.clientSubscriptions.get(socket)?.delete(symbol);
    const subscribers = this.symbolSubscribers.get(symbol);
    if (!subscribers) return;
    subscribers.delete(socket);
    if (subscribers.size === 0) this.symbolSubscribers.delete(symbol);
    this.onRefsMaybeChanged(symbol);
  }

  /** viewerRefs (connected WS clients) + alertRefs (enabled alerts) - see class doc. */
  private totalRefs(symbol: string): number {
    return (this.symbolSubscribers.get(symbol)?.size ?? 0) + (this.alertRefCounts.get(symbol) ?? 0);
  }

  /**
   * Called whenever a ref source might have dropped a symbol to zero.
   * Never unsubscribes immediately (Decision 2's idle grace) - just
   * schedules the symbol for a sweep on the next heartbeat tick, which
   * only actually unsubscribes if refs are STILL zero at that point.
   */
  private onRefsMaybeChanged(symbol: string): void {
    if (this.totalRefs(symbol) > 0) return;
    if (this.pendingIdleUnsubscribe.has(symbol)) return;
    this.pendingIdleUnsubscribe.set(symbol, Date.now() + IDLE_GRACE_MS);
  }

  /** Runs every heartbeat tick (see alarm()) - unsubscribes only symbols whose grace has expired AND are still at zero total refs. */
  private sweepIdleUnsubscribes(): void {
    const now = Date.now();
    for (const [symbol, expiresAt] of this.pendingIdleUnsubscribe) {
      if (now < expiresAt) continue;
      this.pendingIdleUnsubscribe.delete(symbol);
      if (this.totalRefs(symbol) === 0) void this.maybeUnsubscribeUpstream(symbol);
    }
  }

  /**
   * Syncs alertRefCounts from the Alert Engine's KV index (a read, not a
   * write - zero KV quota impact). Called via the `/sync-alert-refs`
   * internal route, which the Worker's cron hits once a minute right after
   * refreshAlertIndex (see triggerAlertRefSync/index.ts) - this is what
   * lets an alert-only symbol start being monitored even with no viewer
   * ever connecting (Decision 3), and it piggybacks on the cron's existing
   * cadence rather than running its own separate schedule.
   */
  private async syncAlertRefs(): Promise<void> {
    const index = await getAlertIndex(this.env);
    const nextCounts = new Map<string, number>();
    if (index) {
      for (const [symbol, rows] of Object.entries(index.bySymbol)) {
        if (rows.length > 0) nextCounts.set(symbol, rows.length);
      }
    }

    const allSymbols = new Set([...this.alertRefCounts.keys(), ...nextCounts.keys()]);
    for (const symbol of allSymbols) {
      const before = this.alertRefCounts.get(symbol) ?? 0;
      const after = nextCounts.get(symbol) ?? 0;
      if (before === after) continue;

      if (after > 0) this.alertRefCounts.set(symbol, after);
      else this.alertRefCounts.delete(symbol);

      if (before === 0 && after > 0) {
        this.pendingIdleUnsubscribe.delete(symbol);
        await this.ensureUpstreamSubscribedForMkrSymbol(symbol);
      } else if (after === 0 && before > 0) {
        this.onRefsMaybeChanged(symbol);
      }
    }
  }

  private poolStatusSnapshot() {
    const staleThresholdMs = (Number(this.env.STALE_THRESHOLD_SECONDS) || 90) * 1000;
    const now = Date.now();
    const symbols = new Set([
      ...this.symbolSubscribers.keys(),
      ...this.alertRefCounts.keys(),
      ...this.quoteState.keys(),
      ...this.pendingIdleUnsubscribe.keys(), // otherwise an idle_grace symbol with no quote yet vanishes from the snapshot
    ]);

    return {
      connectedClients: this.clients.size,
      upstreamConnected: this.upstream !== null && this.upstream.readyState === WebSocket.READY_STATE_OPEN,
      upstreamSubscribedProviderSymbols: [...this.upstreamSubscribedProviderSymbols],
      symbols: [...symbols].map((symbol) => {
        const viewerRefs = this.symbolSubscribers.get(symbol)?.size ?? 0;
        const alertRefs = this.alertRefCounts.get(symbol) ?? 0;
        const totalRefs = viewerRefs + alertRefs;
        const quote = this.quoteState.get(symbol);
        return {
          symbol,
          viewerRefs,
          alertRefs,
          totalRefs,
          lifecycle: totalRefs > 0 ? 'hot' : this.pendingIdleUnsubscribe.has(symbol) ? 'idle_grace' : 'cold',
          lastPrice: quote?.price ?? null,
          lastTickAt: quote?.timestamp ?? null,
          isStale: quote ? now - quote.timestamp > staleThresholdMs : null,
        };
      }),
    };
  }

  private async ensureUpstreamSubscribedForMkrSymbol(mkrSymbol: string): Promise<void> {
    const rows = await this.getSymbolRows();
    const providerSymbol = mapSymbolFromRows(rows, mkrSymbol, 'twelve_data');
    if (!providerSymbol) return; // unsupported symbol - silently skip, never guess
    await this.ensureUpstreamSubscribed(providerSymbol);
  }

  private async maybeUnsubscribeUpstream(mkrSymbol: string): Promise<void> {
    const rows = await this.getSymbolRows();
    const providerSymbol = mapSymbolFromRows(rows, mkrSymbol, 'twelve_data');
    if (!providerSymbol || !this.upstreamSubscribedProviderSymbols.has(providerSymbol)) return;
    this.upstreamSubscribedProviderSymbols.delete(providerSymbol);
    this.sendUpstream({ action: 'unsubscribe', params: { symbols: providerSymbol } });
    if (this.upstreamSubscribedProviderSymbols.size === 0 && this.upstream) {
      this.upstream.close();
      this.upstream = null;
    }
  }

  private async ensureUpstreamSubscribed(providerSymbol: string): Promise<void> {
    if (!this.upstream) await this.connectUpstream();
    this.upstreamSubscribedProviderSymbols.add(providerSymbol);
    this.sendUpstream({ action: 'subscribe', params: { symbols: providerSymbol } });
  }

  private sendUpstream(payload: unknown): void {
    if (this.upstream && this.upstream.readyState === WebSocket.READY_STATE_OPEN) {
      this.upstream.send(JSON.stringify(payload));
    }
  }

  private async connectUpstream(): Promise<void> {
    const apiKey = this.env.TWELVE_DATA_API_KEY;
    if (!apiKey) return; // no key configured - stream simply stays empty, never fabricated

    try {
      const response = await fetch(`https://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(apiKey)}`, {
        headers: { Upgrade: 'websocket' },
      });
      const ws = response.webSocket;
      if (!ws) throw new Error('Twelve Data did not upgrade the connection');
      ws.accept();
      this.upstream = ws;
      this.reconnectAttempt = 0;

      ws.addEventListener('message', (event) => this.handleUpstreamMessage(event.data));
      ws.addEventListener('close', () => this.scheduleReconnect());
      ws.addEventListener('error', () => this.scheduleReconnect());

      // Re-subscribe everything this room currently needs, e.g. after a
      // reconnect where `upstreamSubscribedProviderSymbols` already holds
      // the desired set from before the drop.
      for (const providerSymbol of this.upstreamSubscribedProviderSymbols) {
        this.sendUpstream({ action: 'subscribe', params: { symbols: providerSymbol } });
      }

      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.upstream = null;
    if (this.symbolSubscribers.size === 0 && this.alertRefCounts.size === 0) return; // nobody needs data - stay disconnected
    this.reconnectAttempt += 1;
    // Exponential backoff with jitter (Decision 11/Phase 2) - jitter avoids
    // every symbol's reconnect landing on the exact same tick after a
    // shared upstream drop, which would otherwise briefly hammer Twelve
    // Data with a burst of simultaneous reconnect attempts.
    const baseDelaySeconds = Math.min(MAX_BACKOFF_SECONDS, 2 ** this.reconnectAttempt);
    const jitterSeconds = baseDelaySeconds * (0.5 + Math.random() * 0.5);
    void this.state.storage.setAlarm(Date.now() + jitterSeconds * 1000);
  }

  /** Durable Object alarm: heartbeat + idle-grace sweep while connected, reconnect attempt while not. */
  async alarm(): Promise<void> {
    if (this.upstream && this.upstream.readyState === WebSocket.READY_STATE_OPEN) {
      this.sendUpstream({ action: 'heartbeat' });
      this.sweepIdleUnsubscribes();
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
      return;
    }
    if (this.symbolSubscribers.size > 0 || this.alertRefCounts.size > 0) await this.connectUpstream();
  }

  private handleUpstreamMessage(raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string') return;
    let frame: { event?: string; symbol?: string; price?: number };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.event !== 'price' || typeof frame.price !== 'number' || !frame.symbol) return;

    const mkrSymbol = this.mkrSymbolForProviderSymbol(frame.symbol);
    if (!mkrSymbol) return;

    const tick: NormalizedTick = { symbol: mkrSymbol, price: frame.price, timestamp: Date.now(), source: 'twelve_data' };
    // Canonical Market Pool state (Decision 5) - updated for every tick,
    // regardless of whether any viewer is currently subscribed. Recording
    // this BEFORE the viewer-fanout branch below matters: an alert-only
    // symbol (zero viewers, one or more alertRefCounts) has no entry in
    // `subscribers`, so previously this whole method returned early and
    // silently never reached evaluateTick() or recorded a quote for it -
    // a real bug that would have made alert-only monitoring (Decision 3)
    // a no-op the moment it started being exercised by Phase 1/3.
    this.quoteState.set(mkrSymbol, tick);

    const subscribers = this.symbolSubscribers.get(mkrSymbol);
    if (subscribers && subscribers.size > 0) {
      const payload = JSON.stringify(tick);
      for (const socket of subscribers) {
        try {
          socket.send(payload);
        } catch {
          this.removeClient(socket);
        }
      }
    }

    // Candle aggregation (Task 2, Decision 5) - only for timeframes with an
    // actual subscriber (candleDemand), so a symbol nobody wants candles
    // for costs nothing extra per tick.
    const timeframes = this.candleDemand.get(mkrSymbol);
    if (timeframes && timeframes.size > 0) {
      // this.symbolRowsCache is guaranteed non-null here: mkrSymbolForProviderSymbol
      // above already returned early if it were null.
      const policy = this.policyFor(this.symbolRowsCache!.rows, mkrSymbol);
      for (const timeframe of timeframes) {
        const result = this.candleAggregator.ingest(mkrSymbol, timeframe, frame.price, tick.timestamp, 'twelve_data', policy);
        if (result.ignoredAsStale) continue;
        const key = `${mkrSymbol}:${timeframe}`;
        const candleSubs = this.candleSubscribers.get(key);
        if (!candleSubs || candleSubs.size === 0) continue;
        if (result.rolledOverFrom) {
          logInfo('candle rollover', { symbol: mkrSymbol, timeframe, bucketStart: result.current.timestamp });
          this.broadcastCandle(candleSubs, result.rolledOverFrom);
        }
        this.broadcastCandle(candleSubs, result.current);
      }
    }

    // Fire-and-forget, independent of whether any client is subscribed
    // above - alert evaluation must work even with every Flutter app
    // closed. Never awaited: a slow/failed Supabase call must not delay
    // fan-out to connected clients.
    void evaluateTick(this.env, mkrSymbol, frame.price);
  }

  private mkrSymbolForProviderSymbol(providerSymbol: string): string | null {
    if (!this.symbolRowsCache) return null;
    const row = this.symbolRowsCache.rows.find((r) => r.twelve_data_symbol === providerSymbol);
    return row?.symbol ?? null;
  }
}

/**
 * Called once a minute from the Worker's cron, right after
 * refreshAlertIndex (see index.ts's `scheduled` export) - tells the single
 * shared MarketStreamRoom to re-sync its alert refs from the (now
 * freshly-written) alert index. This is what bootstraps and maintains
 * alert-only monitoring (Decision 3) even if no Flutter client has ever
 * opened a WebSocket connection. Fails safe: never throws, only logs -  a
 * transient failure here just means alert-only ref changes wait for the
 * next cron tick, a minute later.
 */
export async function triggerAlertRefSync(env: Env): Promise<void> {
  try {
    const stub = env.MARKET_STREAM.get(env.MARKET_STREAM.idFromName(ROOM_ID));
    await stub.fetch('https://market-stream.internal/sync-alert-refs', { method: 'POST' });
  } catch (err) {
    logError('market pool alert-ref sync failed', { message: (err as Error).message });
  }
}

/** Used by the admin pool-status route (Phase 11 partial) - see admin-market-pool-routes.ts. */
export async function fetchPoolStatus(env: Env): Promise<unknown> {
  const stub = env.MARKET_STREAM.get(env.MARKET_STREAM.idFromName(ROOM_ID));
  const response = await stub.fetch('https://market-stream.internal/pool-status');
  return response.json();
}
