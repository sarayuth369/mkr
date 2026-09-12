import 'dart:async';
import 'dart:math';

import '../../../core/widgets/price_chart.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_service.dart';

class MockMarketService implements MarketService {
  final Random _random = Random(7);
  DateTime? _lastUpdated;
  final Map<String, MarketQuote> _liveOverrides = {};

  @override
  MarketDataMode get mode => MarketDataMode.demo;

  @override
  DateTime? get lastUpdated => _lastUpdated;

  @override
  Future<List<MarketQuote>> getAllQuotes() async {
    await Future.delayed(const Duration(milliseconds: 300));
    _lastUpdated = DateTime.now();
    return MockMarketCatalog.all;
  }

  @override
  Future<List<MarketQuote>> getQuotesByCategory(AssetClass assetClass) async {
    await Future.delayed(const Duration(milliseconds: 250));
    _lastUpdated = DateTime.now();
    return MockMarketCatalog.byAssetClass(assetClass);
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    await Future.delayed(const Duration(milliseconds: 200));
    _lastUpdated = DateTime.now();
    return _liveOverrides[symbol] ?? MockMarketCatalog.bySymbol(symbol);
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
    return MockMarketCatalog.syntheticSeries(symbol, points: points);
  }

  @override
  Future<List<MarketQuote>> search(String query) async {
    await Future.delayed(const Duration(milliseconds: 150));
    return MockMarketCatalog.search(query);
  }

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) {
    return Stream<List<MarketQuote>>.periodic(const Duration(seconds: 4), (_) {
      final updated = <MarketQuote>[];
      for (final symbol in symbols) {
        final base = _liveOverrides[symbol] ?? MockMarketCatalog.bySymbol(symbol);
        if (base == null) continue;
        // Small seeded random walk — enough visible movement to prove the
        // list is "live-ticking" without ever being mislabeled LIVE (this
        // service always reports MarketDataMode.demo).
        final driftPct = (_random.nextDouble() - 0.5) * 0.3;
        final newPrice = base.price * (1 + driftPct / 100);
        final quote = base.copyWith(
          price: newPrice,
          changeAbs: base.changeAbs + (newPrice - base.price),
          changePct: base.changePct + driftPct,
        );
        _liveOverrides[symbol] = quote;
        updated.add(quote);
      }
      _lastUpdated = DateTime.now();
      return updated;
    });
  }

  @override
  Future<void> reconnect() async {
    await Future.delayed(const Duration(milliseconds: 200));
    _lastUpdated = DateTime.now();
  }
}
