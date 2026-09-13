import 'dart:async';
import 'dart:math';

import '../../../core/widgets/price_chart.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_service.dart';
import '../domain/timeframe.dart';
import 'demo_market_simulator.dart';

/// Ticks every catalog symbol on one shared timer via [DemoMarketSimulator],
/// so price / sparkline / line chart / candlestick all read from the same
/// underlying simulated state and stay consistent with each other. The
/// timer only runs while at least one screen is actually listening
/// ([watchQuotes]/[watchCandles]), and can be fully suspended via
/// [pause]/[resume] (e.g. app backgrounded) — never ticks for no reason.
class MockMarketService implements MarketService {
  MockMarketService() : _simulator = DemoMarketSimulator(seed: MockMarketCatalog.all, random: Random(7));

  static const _tickInterval = Duration(milliseconds: 1500);

  final DemoMarketSimulator _simulator;
  DateTime? _lastUpdated;
  Timer? _ticker;
  bool _pausedByLifecycle = false;

  late final StreamController<void> _tickController = StreamController<void>.broadcast(
    onListen: _startTicking,
    onCancel: _stopTicking,
  );

  void _startTicking() {
    if (_ticker != null || _pausedByLifecycle) return;
    _lastUpdated ??= DateTime.now();
    _ticker = Timer.periodic(_tickInterval, (_) {
      _simulator.tickAll();
      _lastUpdated = DateTime.now();
      if (!_tickController.isClosed) _tickController.add(null);
    });
  }

  void _stopTicking() {
    _ticker?.cancel();
    _ticker = null;
  }

  @override
  void pause() {
    _pausedByLifecycle = true;
    _stopTicking();
  }

  @override
  void resume() {
    _pausedByLifecycle = false;
    if (_tickController.hasListener) _startTicking();
  }

  MarketQuote _liveOrCatalog(MarketQuote catalogQuote) => _simulator.currentQuote(catalogQuote.symbol) ?? catalogQuote;

  @override
  MarketDataMode get mode => MarketDataMode.demo;

  @override
  DateTime? get lastUpdated => _lastUpdated;

  @override
  Future<List<MarketQuote>> getAllQuotes() async {
    await Future.delayed(const Duration(milliseconds: 300));
    _lastUpdated = DateTime.now();
    return MockMarketCatalog.all.map(_liveOrCatalog).toList();
  }

  @override
  Future<List<MarketQuote>> getQuotesByCategory(AssetClass assetClass) async {
    await Future.delayed(const Duration(milliseconds: 250));
    _lastUpdated = DateTime.now();
    return MockMarketCatalog.byAssetClass(assetClass).map(_liveOrCatalog).toList();
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    await Future.delayed(const Duration(milliseconds: 200));
    _lastUpdated = DateTime.now();
    final catalogQuote = MockMarketCatalog.bySymbol(symbol);
    if (catalogQuote == null) return _simulator.currentQuote(symbol);
    return _liveOrCatalog(catalogQuote);
  }

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async {
    await Future.delayed(const Duration(milliseconds: 200));
    final points = switch (timeframe) {
      ChartTimeframe.d1 => 24,
      ChartTimeframe.w1 => 28,
      ChartTimeframe.m1 => 30,
      ChartTimeframe.m3 => 36,
      ChartTimeframe.y1 => 52,
    };
    final series = MockMarketCatalog.syntheticSeries(symbol, points: points);
    // Keep the 1D view continuous with whatever the live tick is currently
    // showing, rather than a disconnected synthetic endpoint.
    if (timeframe == ChartTimeframe.d1) {
      final live = _simulator.currentQuote(symbol);
      if (live != null && series.isNotEmpty) series[series.length - 1] = live.price;
    }
    return series;
  }

  @override
  Future<List<MarketQuote>> search(String query) async {
    await Future.delayed(const Duration(milliseconds: 150));
    return MockMarketCatalog.search(query).map(_liveOrCatalog).toList();
  }

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) {
    return _tickController.stream.map(
      (_) => symbols.map(_simulator.currentQuote).whereType<MarketQuote>().toList(),
    );
  }

  @override
  Stream<List<MarketCandle>> watchCandles(String symbol, Timeframe timeframe) {
    // DemoMarketSimulator ticks at one fixed effective interval; timeframe
    // selection in demo mode only changes what the UI displays, never
    // fabricates a different underlying candle shape.
    return _tickController.stream.map((_) => _simulator.currentCandles(symbol));
  }

  @override
  Future<void> reconnect() async {
    await Future.delayed(const Duration(milliseconds: 200));
    _lastUpdated = DateTime.now();
  }
}
