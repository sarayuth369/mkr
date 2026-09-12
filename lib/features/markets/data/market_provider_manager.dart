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

  Future<void> connect() async {
    _rawMode = MarketDataMode.connecting;
    if (await _tryActivate(primary)) return;
    if (secondaryEnabled && secondary != null && await _tryActivate(secondary!)) return;
    _active = null;
    _rawMode = MarketDataMode.providerError;
  }

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

  /// Called whenever [_active] returns an unavailable/empty result. Confirms
  /// via [MarketDataProvider.healthCheck] — never assumes failure from a
  /// single empty response, which could just as easily be a genuinely
  /// unsupported symbol or a quiet closed market — before failing over.
  Future<void> _handleFailure(MarketDataProvider failed) async {
    if (await failed.healthCheck()) return; // transient/expected, not a real failure

    if (failed == primary && secondaryEnabled && secondary != null && await _tryActivate(secondary!)) {
      return;
    }
    _active = null;
    _rawMode = MarketDataMode.providerError;
  }

  Future<MarketQuote?> getQuote(String symbol) async {
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

  Future<List<MarketQuote>> getQuotes(List<String> symbols) async {
    final results = await Future.wait(symbols.map(getQuote));
    return results.whereType<MarketQuote>().toList();
  }

  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) {
    return _candleCache.getOrFetch(symbol, timeframe, () async {
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
    final active = _active;
    if (active == null) return MarketSessionStatus.unknown;
    return active.getMarketStatus(market);
  }

  /// A single shared subscription per requested symbol set — reused across
  /// every caller (Home/Markets/Watchlist/Detail) rather than opening a new
  /// provider stream per screen.
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    final active = _active;
    if (active == null) return const Stream.empty();
    return active.watchQuotes(symbols).map((quote) {
      _lastUpdated = DateTime.now();
      return quote;
    });
  }

  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) {
    final active = _active;
    if (active == null) return const Stream.empty();
    return active.watchCandles(symbol, timeframe);
  }
}
