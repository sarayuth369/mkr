import '../../../core/widgets/price_chart.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_symbol_info.dart';
import 'market_fetch_result.dart';
import 'timeframe.dart';

/// Production path: Flutter → Cloudflare Worker → Twelve Data (or similar)
/// for live quotes — the client never holds a market-data API key.
/// [MockMarketService] serves the static catalog until that backend exists.
///
/// [getAllQuotes]/[getQuotesByCategory]/[search] return a typed
/// [MarketFetchResult] (2026-09-15 frontend hardening task) rather than a
/// bare `List<MarketQuote>` — a real implementation must NEVER collapse a
/// provider failure, rate limit, or offline state into an indistinguishable
/// empty list; an empty list is reserved for a genuinely valid zero-item
/// result. See [ProviderBackedMarketService]/[MarketProviderManager] for how
/// this is produced in real mode.
abstract class MarketService {
  /// The full symbol universe (metadata only — never a quote/price, and for
  /// the real-mode implementation never a provider request) this service
  /// currently has enabled.
  ///
  /// 2026-09-16 post-phone Closed Testing correction task (root cause):
  /// exists specifically so a caller (e.g. [MarketsController]) can show
  /// every known symbol's identity immediately and decide WHICH controlled
  /// subset to actually request quotes for — instead of every screen load
  /// requesting quotes for the entire catalog via [getAllQuotes], which
  /// vastly exceeds Twelve Data Basic's 8-credits-per-minute cap for MKR's
  /// ~20-symbol catalog and was confirmed (physical-device testing,
  /// 2026-09-16) to be the actual cause of Home/Markets intermittently
  /// showing little or no content. Throws [MarketFetchException] on a
  /// genuine catalog-load fault — same contract as [getQuote]/
  /// [getPriceSeries] — never silently empty.
  Future<List<MarketSymbolInfo>> getCatalog();

  /// Full-catalog quote fetch. 2026-09-16 post-phone Closed Testing
  /// correction task: still here for [MarketService]'s own contract
  /// completeness and any narrow caller that genuinely wants it, but
  /// neither [HomeController] nor [MarketsController] call this anymore —
  /// see [getCatalog]'s doc comment for why. Prefer [getCatalog] + a
  /// controlled [getQuotesFor]/[getQuotesByCategory] call instead.
  Future<MarketFetchResult> getAllQuotes();

  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass);

  /// ONE batched fetch for a caller-supplied symbol list (e.g. the user's
  /// Watchlist) - distinct from [getAllQuotes]/[getQuotesByCategory], which
  /// derive their own symbol list from the catalog. Still never N
  /// individual `/quote` calls.
  Future<MarketFetchResult> getQuotesFor(List<String> symbols);

  /// Returns `null` only for a genuine "no data for this symbol" outcome.
  /// Throws [MarketFetchException] for a real fetch fault — every caller
  /// already wraps this in try/catch and converts it to `ApiState.error`.
  Future<MarketQuote?> getQuote(String symbol);

  /// Returns an empty list for a genuine "no history for this symbol"
  /// outcome (including a disabled/unknown symbol in real mode). Throws
  /// [MarketFetchException] for a real fetch/catalog fault — same contract
  /// as [getQuote] — so a caller with state to report a real failure with
  /// can distinguish it from an honestly empty series.
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe);

  Future<MarketFetchResult> search(String query);

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
  /// candle last) for a single symbol at the given [timeframe], updating as
  /// ticks arrive. Backs the candlestick chart the same way [watchQuotes]
  /// backs price lists — same underlying tick source, so price/sparkline/
  /// candle stay consistent.
  Stream<List<MarketCandle>> watchCandles(String symbol, Timeframe timeframe);

  /// Re-establish the data connection (no-op for the mock beyond resetting
  /// [lastUpdated]).
  Future<void> reconnect();

  /// Pause background simulation/streaming (e.g. app backgrounded) to avoid
  /// wasted work; [resume] restarts it. No-op for a real push-based
  /// implementation that doesn't poll.
  void pause();

  void resume();
}
