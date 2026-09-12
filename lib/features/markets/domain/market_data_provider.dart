import '../../../domain/market_candle.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_session_status.dart';
import 'timeframe.dart';

/// One real (or demo) market-data source, behind a single provider-agnostic
/// shape. [MarketProviderManager] is the only thing that talks to these
/// directly — the rest of the app (UI, [MarketService]) never knows which
/// provider is active.
///
/// Every implementation must return `null`/empty rather than fabricate a
/// value it doesn't actually have (a missing bid, an unsupported symbol, an
/// unreachable candle range all mean "unavailable", never a guess).
abstract class MarketDataProvider {
  /// Stable identifier used in logs/telemetry and by [MarketDataSource].
  String get id;

  Future<MarketQuote?> getQuote(String symbol);

  Future<List<MarketQuote>> getQuotes(List<String> symbols);

  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe);

  /// Live per-symbol ticks for [symbols] over this provider's single shared
  /// connection — callers must not open one of these per screen/widget.
  Stream<MarketQuote> watchQuotes(List<String> symbols);

  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe);

  Future<MarketSessionStatus> getMarketStatus(String market);

  /// Cheap liveness probe used by [MarketProviderManager] to decide whether
  /// this provider is usable right now — must not be confused with
  /// [getMarketStatus] (that's about the *exchange's* schedule, this is
  /// about whether *this provider* can currently be reached at all).
  Future<bool> healthCheck();

  Future<void> connect();

  Future<void> disconnect();
}
