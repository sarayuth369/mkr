import 'dart:async';

import '../../../core/widgets/price_chart.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_fetch_result.dart';
import '../domain/market_service.dart';
import '../domain/timeframe.dart';
import 'market_catalog_repository.dart';
import 'market_provider_manager.dart';

/// [MarketService] implementation backed by a real [MarketProviderManager]
/// (Twelve Data primary, Alpaca standby) instead of [DemoMarketSimulator].
/// Selected in `app.dart` when [MarketDataConfig.mode] is
/// [MarketDataRunMode.real] — every other controller/screen in the app
/// keeps depending on the unchanged [MarketService] interface and needs no
/// changes to use this instead of [MockMarketService].
///
/// 2026-09-15 hardening task: which symbols to request now comes from
/// [MarketCatalogRepository] (the real backend catalog), never
/// [MockMarketCatalog] — a disabled/removed backend symbol is never
/// requested, and the mock catalog is never used as a silent fallback if
/// the real catalog fails to load (that surfaces as an honest
/// [MarketFetchFailure] instead).
///
/// Symbols this provider set doesn't cover are simply omitted from list
/// results rather than backfilled with a fabricated value — callers already
/// handle a shorter-than-expected list the same way they handle any other
/// partial/empty state.
class ProviderBackedMarketService implements MarketService {
  ProviderBackedMarketService(this._manager, this._catalog);

  final MarketProviderManager _manager;
  final MarketCatalogRepository _catalog;

  @override
  MarketDataMode get mode => _manager.mode;

  @override
  DateTime? get lastUpdated => _manager.lastUpdated;

  Future<MarketFetchResult> _fetchSymbols(List<String> Function(List<CatalogSymbol>) select) async {
    final List<CatalogSymbol> catalog;
    try {
      catalog = await _catalog.load();
    } on MarketCatalogException catch (e) {
      return MarketFetchFailure(MarketFetchFailureKind.offline, e.message);
    }
    final symbols = select(catalog);
    if (symbols.isEmpty) return const MarketFetchEmpty();
    return _manager.getQuotes(symbols);
  }

  @override
  Future<MarketFetchResult> getAllQuotes() {
    return _fetchSymbols((catalog) => catalog.map((s) => s.symbol).toList());
  }

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) {
    return _fetchSymbols((catalog) => catalog.where((s) => s.assetClass == assetClass).map((s) => s.symbol).toList());
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) => _manager.getQuote(symbol);

  /// 2026-09-15 correction task: a caller-supplied symbol list (e.g. a
  /// saved Watchlist, which can retain a symbol the backend later disables
  /// or removes) is now validated against [MarketCatalogRepository] before
  /// anything reaches [MarketProviderManager] - a disabled/unknown symbol
  /// is filtered out here and NEVER requested from the provider, matching
  /// [getAllQuotes]/[getQuotesByCategory]/[search]'s existing rule.
  ///
  /// A filtered-out symbol is represented honestly rather than silently
  /// dropped: if at least one requested symbol resolves, the result is a
  /// [MarketFetchPartial] whose `failedSymbols` includes every catalog-
  /// disabled/unknown symbol alongside any genuine provider-level failure -
  /// the caller (e.g. [WatchlistController]) already renders that the same
  /// way it renders any other partial result, without needing to know
  /// WHY a symbol didn't come back.
  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async {
    if (symbols.isEmpty) return const MarketFetchEmpty();

    final List<CatalogSymbol> catalog;
    try {
      catalog = await _catalog.load();
    } on MarketCatalogException catch (e) {
      return MarketFetchFailure(MarketFetchFailureKind.offline, e.message);
    }

    final enabled = catalog.map((s) => s.symbol).toSet();
    final requestable = symbols.where(enabled.contains).toList();
    final filteredOut = symbols.where((s) => !enabled.contains(s)).toList();

    if (requestable.isEmpty) {
      // Every requested symbol is disabled/unknown - never contact the
      // provider for a symbol the backend catalog doesn't currently allow.
      return const MarketFetchEmpty();
    }

    final result = await _manager.getQuotes(requestable);
    if (filteredOut.isEmpty) return result;

    return switch (result) {
      MarketFetchSuccess(:final quotes) => MarketFetchPartial(quotes, filteredOut),
      MarketFetchPartial(:final quotes, :final failedSymbols) => MarketFetchPartial(quotes, [...failedSymbols, ...filteredOut]),
      // A genuinely empty or hard-failed provider result already carries
      // its own honest state - catalog-filtered symbols add no further
      // signal there (a provider outage/empty result is the dominant fact).
      MarketFetchEmpty() => result,
      MarketFetchFailure() => result,
    };
  }

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async {
    final candles = await _manager.getHistoricalCandles(symbol, timeframeForChartRange(timeframe));
    return candles.map((c) => c.close).toList();
  }

  @override
  Future<MarketFetchResult> search(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return Future.value(const MarketFetchEmpty());
    return _fetchSymbols(
      (catalog) => catalog.where((s) => s.symbol.toLowerCase().contains(q) || s.displayName.toLowerCase().contains(q)).map((s) => s.symbol).toList(),
    );
  }

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) {
    final latest = <String, MarketQuote>{};
    late StreamController<List<MarketQuote>> controller;
    StreamSubscription<MarketQuote>? subscription;
    controller = StreamController<List<MarketQuote>>.broadcast(
      onListen: () {
        subscription = _manager.watchQuotes(symbols).listen((quote) {
          latest[quote.symbol] = quote;
          if (!controller.isClosed) {
            controller.add(symbols.map((s) => latest[s]).whereType<MarketQuote>().toList());
          }
        });
      },
      onCancel: () => subscription?.cancel(),
    );
    return controller.stream;
  }

  /// Buckets raw per-tick candles (each provider emits one degenerate
  /// O=H=L=C=price "candle" per tick — see [MarketDataProvider.watchCandles])
  /// into [timeframe]-sized intervals: a tick landing in the same bucket as
  /// the last candle updates that candle's high/low/close in place; a tick
  /// in a new bucket starts a fresh candle. Without this, every single tick
  /// would append as its own permanent 1-price-point candle, growing the
  /// list unboundedly and never actually aggregating into real OHLC bars.
  @override
  Stream<List<MarketCandle>> watchCandles(String symbol, Timeframe timeframe) {
    late StreamController<List<MarketCandle>> controller;
    var history = <MarketCandle>[];
    StreamSubscription<MarketCandle>? subscription;
    controller = StreamController<List<MarketCandle>>.broadcast(
      onListen: () async {
        history = await _manager.getHistoricalCandles(symbol, timeframe);
        if (!controller.isClosed) controller.add(history);
        subscription = _manager.watchCandles(symbol, timeframe).listen((tick) {
          history = _mergeTick(history, tick, timeframe);
          if (!controller.isClosed) controller.add(history);
        });
      },
      onCancel: () => subscription?.cancel(),
    );
    return controller.stream;
  }

  List<MarketCandle> _mergeTick(List<MarketCandle> history, MarketCandle tick, Timeframe timeframe) {
    if (history.isEmpty) return [tick];
    final last = history.last;
    final bucketMs = timeframe.approxBucketDuration.inMilliseconds;
    final sameBucket = (tick.time.millisecondsSinceEpoch ~/ bucketMs) == (last.time.millisecondsSinceEpoch ~/ bucketMs);
    if (sameBucket) {
      final merged = last.copyWith(
        high: tick.close > last.high ? tick.close : last.high,
        low: tick.close < last.low ? tick.close : last.low,
        close: tick.close,
      );
      return [...history.sublist(0, history.length - 1), merged];
    }
    return [...history, tick];
  }

  @override
  Future<void> reconnect() => _manager.reconnect();

  @override
  void pause() {
    unawaited(_manager.disconnect());
  }

  @override
  void resume() {
    unawaited(_manager.connect());
  }
}
