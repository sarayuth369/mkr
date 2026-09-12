import '../../../../domain/asset_class.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_data_source.dart';
import '../../../../domain/market_quote.dart';
import '../../../../domain/market_session_status.dart';

/// Pure JSON parsing for Twelve Data's documented response shapes, isolated
/// from networking so it can be unit-tested against fixture JSON (including
/// malformed/missing-field/error/rate-limit shapes) without a live
/// connection. Every field is read defensively — a missing or wrong-typed
/// value becomes `null`/a skipped record, never a fabricated number.
class TwelveDataParser {
  const TwelveDataParser._();

  static bool isErrorResponse(Map<String, dynamic> json) => json['status'] == 'error';

  /// Twelve Data reports rate limiting as an error response whose `code` is
  /// 429 or whose message mentions the API credit limit.
  static bool isRateLimited(Map<String, dynamic> json) {
    if (!isErrorResponse(json)) return false;
    final code = json['code'];
    final message = (json['message'] as Object?)?.toString().toLowerCase() ?? '';
    return code == 429 || message.contains('api credits') || message.contains('rate limit');
  }

  static double? _num(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Parses a Twelve Data `/quote` response into a [MarketQuote] for
  /// [mkrSymbol]/[assetClass]. Returns `null` for an error/rate-limit shape
  /// or a response missing the one field that can't be sensibly defaulted
  /// (the last price).
  static MarketQuote? parseQuote({
    required Map<String, dynamic> json,
    required String mkrSymbol,
    required AssetClass assetClass,
  }) {
    if (isErrorResponse(json)) return null;
    final price = _num(json['close']) ?? _num(json['price']);
    if (price == null) return null;

    final prevClose = _num(json['previous_close']);
    final changeAbs = _num(json['change']) ?? (prevClose != null ? price - prevClose : 0.0);
    final changePct = _num(json['percent_change']) ??
        (prevClose != null && prevClose != 0 ? (changeAbs / prevClose) * 100 : 0.0);

    return MarketQuote(
      symbol: mkrSymbol,
      name: (json['name'] as Object?)?.toString() ?? mkrSymbol,
      assetClass: assetClass,
      price: price,
      changeAbs: changeAbs,
      changePct: changePct,
      high: _num(json['high']),
      low: _num(json['low']),
      open: _num(json['open']),
      prevClose: prevClose,
      volume: _num(json['volume']),
      currency: (json['currency'] as Object?)?.toString() ?? 'USD',
      source: MarketDataSource.twelveData,
      isLive: true,
      sessionStatus: json['is_market_open'] == true
          ? MarketSessionStatus.open
          : json['is_market_open'] == false
              ? MarketSessionStatus.closed
              : null,
    );
  }

  /// Parses a Twelve Data `/time_series` response into oldest-first candles.
  /// Returns an empty list (never fabricated bars) for an error shape or a
  /// response with no usable `values`.
  static List<MarketCandle> parseCandles(Map<String, dynamic> json) {
    if (isErrorResponse(json)) return const [];
    final values = json['values'];
    if (values is! List) return const [];

    final candles = <MarketCandle>[];
    for (final entry in values) {
      if (entry is! Map) continue;
      final map = entry.cast<String, dynamic>();
      final open = _num(map['open']);
      final high = _num(map['high']);
      final low = _num(map['low']);
      final close = _num(map['close']);
      final datetime = (map['datetime'] as Object?)?.toString();
      if (open == null || high == null || low == null || close == null || datetime == null) continue;
      final time = DateTime.tryParse(datetime);
      if (time == null) continue;
      candles.add(MarketCandle(
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: _num(map['volume']),
        source: MarketDataSource.twelveData,
      ));
    }
    // Twelve Data returns newest-first; the app's candle consumers expect
    // oldest-first (matching DemoMarketSimulator's history ordering).
    return candles.reversed.toList();
  }

  /// Parses one Twelve Data WebSocket price-event frame. Returns `null` for
  /// any other event type (subscribe-status, heartbeat) or a malformed
  /// price frame.
  static MarketQuote? parseWsPriceEvent({
    required Map<String, dynamic> json,
    required String mkrSymbol,
    required AssetClass assetClass,
  }) {
    if (json['event'] != 'price') return null;
    final price = _num(json['price']);
    if (price == null) return null;
    return MarketQuote(
      symbol: mkrSymbol,
      name: mkrSymbol,
      assetClass: assetClass,
      price: price,
      changeAbs: 0,
      changePct: 0,
      source: MarketDataSource.twelveData,
      isLive: true,
    );
  }
}
