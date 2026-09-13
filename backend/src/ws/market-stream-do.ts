import { evaluateTick } from '../alerts/alert-engine';
import { catalogFor } from '../symbols/symbol-catalog';
import { mapSymbolFromRows } from '../symbols/symbol-mapper';
import type { Env } from '../types';

interface NormalizedTick {
  symbol: string;
  price: number;
  timestamp: number;
  source: 'twelve_data';
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const SYMBOL_CACHE_TTL_MS = 5 * 60_000;
const MAX_BACKOFF_SECONDS = 30;

/**
 * ONE Durable Object instance ("global", see [roomId]) holds the single
 * shared upstream Twelve Data WebSocket connection and fans normalized
 * ticks out to every connected Flutter client - the server-side
 * counterpart of the "Flutter Client A/B/C -> MKR WS Gateway -> Twelve
 * Data WS" diagram in the Phase 2 spec. A Durable Object is the correct
 * Cloudflare-native primitive here because a plain Worker has no
 * persistent state across requests/isolates; this is the one place in the
 * backend that genuinely needs it (see docs/MKR-PHASE2-ARCHITECTURE.md).
 *
 * One room today; if a single Twelve Data WS connection's symbol-count
 * limit is ever a real constraint, sharding by symbol-set into multiple
 * rooms is a natural next step - not built now, to avoid overengineering.
 */
export class MarketStreamRoom {
  private clients = new Set<WebSocket>();
  private clientSubscriptions = new Map<WebSocket, Set<string>>(); // client -> MKR symbols
  private symbolSubscribers = new Map<string, Set<WebSocket>>(); // MKR symbol -> clients

  private upstream: WebSocket | null = null;
  private upstreamSubscribedProviderSymbols = new Set<string>();
  private reconnectAttempt = 0;

  private symbolRowsCache: { rows: Awaited<ReturnType<ReturnType<typeof catalogFor>['all']>>; fetchedAt: number } | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
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
  }

  private async handleClientMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let msg: { action?: string; symbols?: string[] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(msg.symbols)) return;
    const symbols = [...new Set(msg.symbols.map((s) => String(s).toUpperCase()))];

    if (msg.action === 'subscribe') {
      await this.subscribeClient(socket, symbols);
    } else if (msg.action === 'unsubscribe') {
      for (const symbol of symbols) this.unsubscribeClientFromSymbol(socket, symbol);
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

      if (isNewSymbol) await this.ensureUpstreamSubscribed(providerSymbol);
    }
    this.clientSubscriptions.set(socket, clientSymbols);
  }

  private unsubscribeClientFromSymbol(socket: WebSocket, symbol: string): void {
    this.clientSubscriptions.get(socket)?.delete(symbol);
    const subscribers = this.symbolSubscribers.get(symbol);
    if (!subscribers) return;
    subscribers.delete(socket);
    if (subscribers.size === 0) {
      this.symbolSubscribers.delete(symbol);
      void this.maybeUnsubscribeUpstream(symbol);
    }
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
    if (this.symbolSubscribers.size === 0) return; // nobody needs data - stay disconnected
    this.reconnectAttempt += 1;
    const delaySeconds = Math.min(MAX_BACKOFF_SECONDS, 2 ** this.reconnectAttempt);
    void this.state.storage.setAlarm(Date.now() + delaySeconds * 1000);
  }

  /** Durable Object alarm: heartbeat while connected, reconnect attempt while not. */
  async alarm(): Promise<void> {
    if (this.upstream && this.upstream.readyState === WebSocket.READY_STATE_OPEN) {
      this.sendUpstream({ action: 'heartbeat' });
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
      return;
    }
    if (this.symbolSubscribers.size > 0) await this.connectUpstream();
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
    const subscribers = this.symbolSubscribers.get(mkrSymbol);
    if (!subscribers || subscribers.size === 0) return;

    const tick: NormalizedTick = { symbol: mkrSymbol, price: frame.price, timestamp: Date.now(), source: 'twelve_data' };
    const payload = JSON.stringify(tick);
    for (const socket of subscribers) {
      try {
        socket.send(payload);
      } catch {
        this.removeClient(socket);
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
