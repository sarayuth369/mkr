import '../../../domain/market_candle.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_session_status.dart';
import 'market_fetch_result.dart';
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

  /// Returns `null` only for a genuine "no data for this symbol" outcome
  /// (an unsupported symbol, or a healthy-but-empty backend response).
  /// Throws [MarketFetchException] for a real fetch fault (HTTP non-200,
  /// malformed response, a provider error envelope, a timeout, or a
  /// connection failure) — 2026-09-15 hardening task: a real failure must
  /// never be silently indistinguishable from "no data".
  Future<MarketQuote?> getQuote(String symbol);

  /// Never throws — every outcome (full success, partial success with
  /// per-symbol failures, a genuinely empty result, or a hard provider/
  /// offline failure) is encoded in the returned [MarketFetchResult] so
  /// [MarketProviderManager] can react uniformly without a try/catch around
  /// every call site.
  Future<MarketFetchResult> getQuotes(List<String> symbols);

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
