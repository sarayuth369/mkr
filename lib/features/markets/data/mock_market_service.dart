import '../../../core/widgets/price_chart.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_service.dart';

class MockMarketService implements MarketService {
  @override
  Future<List<MarketQuote>> getAllQuotes() async {
    await Future.delayed(const Duration(milliseconds: 300));
    return MockMarketCatalog.all;
  }

  @override
  Future<List<MarketQuote>> getQuotesByCategory(AssetClass assetClass) async {
    await Future.delayed(const Duration(milliseconds: 250));
    return MockMarketCatalog.byAssetClass(assetClass);
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return MockMarketCatalog.bySymbol(symbol);
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
}
