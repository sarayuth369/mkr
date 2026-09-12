import '../../../core/widgets/price_chart.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_quote.dart';

/// Production path: Flutter → Cloudflare Worker → Twelve Data (or similar)
/// for live quotes. [MockMarketService] serves the static catalog in Phase 1.
abstract class MarketService {
  Future<List<MarketQuote>> getAllQuotes();

  Future<List<MarketQuote>> getQuotesByCategory(AssetClass assetClass);

  Future<MarketQuote?> getQuote(String symbol);

  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe);

  Future<List<MarketQuote>> search(String query);
}
