import '../../../core/widgets/price_chart.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';

/// Production path: Flutter → Cloudflare Worker → Twelve Data (or similar)
/// for live quotes — the client never holds a market-data API key.
/// [MockMarketService] serves the static catalog until that backend exists.
abstract class MarketService {
  Future<List<MarketQuote>> getAllQuotes();

  Future<List<MarketQuote>> getQuotesByCategory(AssetClass assetClass);

  Future<MarketQuote?> getQuote(String symbol);

  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe);

  Future<List<MarketQuote>> search(String query);

  /// Where the data returned above is actually coming from right now.
  /// A real implementation flips this to [MarketDataMode.live] only once
  /// genuinely connected to the backend, [MarketDataMode.stale] when the
  /// last successful fetch is old, and [MarketDataMode.offline] on a
  /// connection failure — [MockMarketService] always reports [MarketDataMode.demo].
  MarketDataMode get mode;

  /// When [mode]'s underlying data was last refreshed, if known.
  DateTime? get lastUpdated;

  /// Subscribe to price updates for [symbols]. A real implementation backs
  /// this with a Cloudflare Worker WebSocket/SSE feed; [MockMarketService]
  /// simulates gentle movement so lists visibly tick without ever claiming
  /// to be live.
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols);

  /// Subscribe to the OHLC candle history (oldest first, current forming
  /// candle last) for a single symbol, updating as ticks arrive. Backs the
  /// candlestick chart the same way [watchQuotes] backs price lists — same
  /// underlying tick source, so price/sparkline/candle stay consistent.
  Stream<List<MarketCandle>> watchCandles(String symbol);

  /// Re-establish the data connection (no-op for the mock beyond resetting
  /// [lastUpdated]).
  Future<void> reconnect();

  /// Pause background simulation/streaming (e.g. app backgrounded) to avoid
  /// wasted work; [resume] restarts it. No-op for a real push-based
  /// implementation that doesn't poll.
  void pause();

  void resume();
}
