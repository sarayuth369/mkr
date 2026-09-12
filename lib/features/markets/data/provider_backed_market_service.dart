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

  static const _defaultDetailTimeframe = Timeframe.h1;

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

  @override
  Stream<List<MarketCandle>> watchCandles(String symbol) {
    late StreamController<List<MarketCandle>> controller;
    var history = <MarketCandle>[];
    StreamSubscription<MarketCandle>? subscription;
    controller = StreamController<List<MarketCandle>>.broadcast(
      onListen: () async {
        history = await _manager.getHistoricalCandles(symbol, _defaultDetailTimeframe);
        if (!controller.isClosed) controller.add(history);
        subscription = _manager.watchCandles(symbol, _defaultDetailTimeframe).listen((candle) {
          if (!controller.isClosed) controller.add([...history, candle]);
        });
      },
      onCancel: () => subscription?.cancel(),
    );
    return controller.stream;
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
