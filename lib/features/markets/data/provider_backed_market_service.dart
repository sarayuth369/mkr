import 'dart:async';

import '../../../core/widgets/price_chart.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_service.dart';
import '../domain/timeframe.dart';
import 'market_provider_manager.dart';

/// [MarketService] implementation backed by a real [MarketProviderManager]
/// (Twelve Data primary, Alpaca standby) instead of [DemoMarketSimulator].
/// Selected in `app.dart` when [MarketDataConfig.mode] is
/// [MarketDataRunMode.real] — every other controller/screen in the app
/// keeps depending on the unchanged [MarketService] interface and needs no
/// changes to use this instead of [MockMarketService].
///
/// Symbols this provider set doesn't cover (see [SymbolMapper]) are simply
/// omitted from list results rather than backfilled with a fabricated
/// value — callers already handle a shorter-than-expected list the same
/// way they handle any other partial/empty state.
class ProviderBackedMarketService implements MarketService {
  ProviderBackedMarketService(this._manager);

  final MarketProviderManager _manager;

  @override
  MarketDataMode get mode => _manager.mode;

  @override
  DateTime? get lastUpdated => _manager.lastUpdated;

  @override
  Future<List<MarketQuote>> getAllQuotes() {
    final symbols = MockMarketCatalog.all.map((q) => q.symbol).toList();
    return _manager.getQuotes(symbols);
  }

  @override
  Future<List<MarketQuote>> getQuotesByCategory(AssetClass assetClass) {
    final symbols = MockMarketCatalog.byAssetClass(assetClass).map((q) => q.symbol).toList();
    return _manager.getQuotes(symbols);
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) => _manager.getQuote(symbol);

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async {
    final candles = await _manager.getHistoricalCandles(symbol, timeframeForChartRange(timeframe));
    return candles.map((c) => c.close).toList();
  }

  @override
  Future<List<MarketQuote>> search(String query) {
    final symbols = MockMarketCatalog.search(query).map((q) => q.symbol).toList();
    return _manager.getQuotes(symbols);
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
