import 'dart:async';

import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_session_status.dart';
import '../domain/market_data_provider.dart';
import '../domain/timeframe.dart';
import 'candle_cache.dart';

/// The provider health/failover engine:
/// `Twelve Data (primary) → [health check] → Alpaca (secondary, if enabled)`,
/// modeled on `auc/backend`'s crypto-provider fallback pattern (try in
/// priority order, stop at the first healthy one).
///
/// The critical rule this class exists to enforce: **a quiet market is not
/// a provider failure.** [MarketSessionStatus] (the exchange's schedule) is
/// looked up separately from [healthCheck] (this provider's own
/// reachability) — failover only ever happens because [healthCheck] says a
/// provider is actually unreachable, never because ticks stopped arriving
/// (which is expected and normal outside trading hours).
class MarketProviderManager {
  MarketProviderManager({
    required this.primary,
    this.secondary,
    this.secondaryEnabled = false,
    CandleCache? candleCache,
    Duration? staleAfter,
  })  : _candleCache = candleCache ?? CandleCache(),
        _staleAfter = staleAfter ?? const Duration(seconds: 60);

  final MarketDataProvider primary;
  final MarketDataProvider? secondary;
  final bool secondaryEnabled;
  final CandleCache _candleCache;
  final Duration _staleAfter;

  MarketDataMode _rawMode = MarketDataMode.offline;
  DateTime? _lastUpdated;
  MarketDataProvider? _active;
  Future<void>? _connectFuture;

  /// The currently active provider, if any — exposed for tests/telemetry.
  MarketDataProvider? get activeProvider => _active;

  DateTime? get lastUpdated => _lastUpdated;

  /// [_rawMode] downgraded to [MarketDataMode.stale] when the last
  /// successful update is older than [_staleAfter], even though the
  /// connection itself is still nominally "live".
  MarketDataMode get mode {
    if (_rawMode == MarketDataMode.live &&
        _lastUpdated != null &&
        DateTime.now().difference(_lastUpdated!) > _staleAfter) {
      return MarketDataMode.stale;
    }
    return _rawMode;
  }

  /// Always starts a fresh connection attempt and updates [ensureConnected]'s
  /// shared future to point at it — used for an explicit reconnect (e.g.
  /// [ProviderBackedMarketService.resume] after the app was backgrounded).
  Future<void> connect() {
    final future = _doConnect();
    _connectFuture = future;
    return future;
  }

  Future<void> _doConnect() async {
    _rawMode = MarketDataMode.connecting;
    if (await _tryActivate(primary)) return;
    if (secondaryEnabled && secondary != null && await _tryActivate(secondary!)) return;
    _active = null;
    _rawMode = MarketDataMode.providerError;
  }

  /// Awaited by every data-fetching method below so a caller that starts
  /// querying immediately after construction (every controller does, in its
  /// own constructor) blocks on the SAME in-flight connection attempt kicked
  /// off at startup, instead of racing it and silently seeing `_active ==
  /// null` (confirmed live: without this, Home's first `getAllQuotes()` call
  /// always lost the race against the health-check, returning an empty list
  /// forever with no error and no retry). A no-op once already connected.
  Future<void> ensureConnected() => _connectFuture ?? connect();

  Future<bool> _tryActivate(MarketDataProvider provider) async {
    if (!await provider.healthCheck()) return false;
    await provider.connect();
    _active = provider;
    _rawMode = MarketDataMode.live;
    return true;
  }

  Future<void> disconnect() async {
    await primary.disconnect();
    if (secondaryEnabled) await secondary?.disconnect();
    _active = null;
    _rawMode = MarketDataMode.offline;
  }

  Future<void> reconnect() => connect();

  Future<void>? _failureHandlingFuture;

  /// Called whenever [_active] returns an unavailable/empty result. Confirms
  /// via [MarketDataProvider.healthCheck] — never assumes failure from a
  /// single empty response, which could just as easily be a genuinely
  /// unsupported symbol or a quiet closed market — before failing over.
  ///
  /// [getAllQuotes] fires every catalog symbol concurrently via
  /// `Future.wait`, so several unsupported/unmapped symbols (e.g. ones the
  /// backend catalog disables or doesn't map for this provider) can each
  /// return null in the same instant. Without deduplication, each one would
  /// independently trigger its own healthCheck() call — a real network
  /// request — and any single one of those being slow/flaky/rate-limited
  /// could spuriously null out [_active] for the WHOLE manager, even while
  /// every other symbol is working fine (confirmed live: a Markets screen
  /// showing real prices for six symbols alongside a "PROVIDER UNAVAILABLE"
  /// status chip, caused by exactly this concurrent-storm race). Collapsing
  /// concurrent calls into one shared in-flight check removes the storm.
  Future<void> _handleFailure(MarketDataProvider failed) {
    return _failureHandlingFuture ??= _doHandleFailure(failed).whenComplete(() => _failureHandlingFuture = null);
  }

  Future<void> _doHandleFailure(MarketDataProvider failed) async {
    if (await failed.healthCheck()) return; // transient/expected, not a real failure

    if (failed == primary && secondaryEnabled && secondary != null && await _tryActivate(secondary!)) {
      return;
    }
    _active = null;
    _rawMode = MarketDataMode.providerError;
  }

  Future<MarketQuote?> getQuote(String symbol) async {
    await ensureConnected();
    final active = _active;
    if (active == null) return null;
    final quote = await active.getQuote(symbol);
    if (quote != null) {
      _lastUpdated = DateTime.now();
      return quote;
    }
    await _handleFailure(active);
    final fallback = _active;
    if (fallback == null || identical(fallback, active)) return null;
    final retried = await fallback.getQuote(symbol);
    if (retried != null) _lastUpdated = DateTime.now();
    return retried;
  }

  /// ONE batched provider call for every symbol — looping [getQuote] here
  /// (even concurrently) would mean one upstream REST request per symbol
  /// for a single screen load, which is exactly the request storm this
  /// architecture exists to prevent (confirmed live against the deployed
  /// backend: ~28 concurrent individual quote calls exhausted Twelve Data
  /// Free's rate limit and every single one came back unavailable).
  Future<List<MarketQuote>> getQuotes(List<String> symbols) async {
    if (symbols.isEmpty) return const [];
    await ensureConnected();
    final active = _active;
    if (active == null) return const [];
    final results = await active.getQuotes(symbols);
    if (results.isNotEmpty) _lastUpdated = DateTime.now();
    return results;
  }

  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) {
    return _candleCache.getOrFetch(symbol, timeframe, () async {
      await ensureConnected();
      final active = _active;
      if (active == null) return const [];
      final candles = await active.getHistoricalCandles(symbol, timeframe);
      if (candles.isNotEmpty) return candles;
      await _handleFailure(active);
      final fallback = _active;
      if (fallback == null || identical(fallback, active)) return const [];
      return fallback.getHistoricalCandles(symbol, timeframe);
    });
  }

  Future<MarketSessionStatus> getMarketStatus(String market) async {
    await ensureConnected();
    final active = _active;
    if (active == null) return MarketSessionStatus.unknown;
    return active.getMarketStatus(market);
  }

  /// A single shared subscription per requested symbol set — reused across
  /// every caller (Home/Markets/Watchlist/Detail) rather than opening a new
  /// provider stream per screen.
  Stream<MarketQuote> watchQuotes(List<String> symbols) async* {
    await ensureConnected();
    final active = _active;
    if (active == null) return;
    yield* active.watchQuotes(symbols).map((quote) {
      _lastUpdated = DateTime.now();
      return quote;
    });
  }

  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) async* {
    await ensureConnected();
    final active = _active;
    if (active == null) return;
    yield* active.watchCandles(symbol, timeframe);
  }
}
