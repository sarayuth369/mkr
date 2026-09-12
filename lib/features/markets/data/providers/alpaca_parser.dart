import '../../../../domain/asset_class.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_data_source.dart';
import '../../../../domain/market_quote.dart';

/// Pure JSON parsing for Alpaca's documented Market Data API shapes.
/// Standby-only for Phase 1 (see [AlpacaProvider]) but parsed with the same
/// defensive discipline as [TwelveDataParser] so it's ready to activate
/// later without a rewrite.
class AlpacaParser {
  const AlpacaParser._();

  /// Alpaca error responses are `{"code": <int>, "message": "..."}` with no
  /// data payload alongside them.
  static bool isErrorResponse(Map<String, dynamic> json) => json.containsKey('code') && json.containsKey('message') && !json.containsKey('bars');

  static double? _num(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Parses a `/v2/stocks/{symbol}/snapshot`-shaped response: latest trade
  /// price plus the latest quote's bid/ask, when present.
  static MarketQuote? parseSnapshot({
    required Map<String, dynamic> json,
    required String mkrSymbol,
    required AssetClass assetClass,
  }) {
    if (isErrorResponse(json)) return null;
    final latestTrade = json['latestTrade'];
    final price = latestTrade is Map ? _num(latestTrade['p']) : null;
    if (price == null) return null;

    final prevDailyBar = json['prevDailyBar'];
    final prevClose = prevDailyBar is Map ? _num(prevDailyBar['c']) : null;
    final changeAbs = prevClose != null ? price - prevClose : 0.0;
    final changePct = (prevClose != null && prevClose != 0) ? (changeAbs / prevClose) * 100 : 0.0;

    final latestQuote = json['latestQuote'];
    final bid = latestQuote is Map ? _num(latestQuote['bp']) : null;
    final ask = latestQuote is Map ? _num(latestQuote['ap']) : null;

    final dailyBar = json['dailyBar'];
    final open = dailyBar is Map ? _num(dailyBar['o']) : null;
    final high = dailyBar is Map ? _num(dailyBar['h']) : null;
    final low = dailyBar is Map ? _num(dailyBar['l']) : null;
    final volume = dailyBar is Map ? _num(dailyBar['v']) : null;

    return MarketQuote(
      symbol: mkrSymbol,
      name: mkrSymbol,
      assetClass: assetClass,
      price: price,
      changeAbs: changeAbs,
      changePct: changePct,
      high: high,
      low: low,
      open: open,
      prevClose: prevClose,
      volume: volume,
      bid: bid,
      ask: ask,
      source: MarketDataSource.alpaca,
      isLive: true,
    );
  }

  /// Parses a `/v2/stocks/{symbol}/bars`-shaped response into oldest-first
  /// candles. Returns an empty list for an error shape or missing `bars`.
  static List<MarketCandle> parseBars(Map<String, dynamic> json) {
    if (isErrorResponse(json)) return const [];
    final bars = json['bars'];
    if (bars is! List) return const [];

    final candles = <MarketCandle>[];
    for (final entry in bars) {
      if (entry is! Map) continue;
      final map = entry.cast<String, dynamic>();
      final open = _num(map['o']);
      final high = _num(map['h']);
      final low = _num(map['l']);
      final close = _num(map['c']);
      final t = (map['t'] as Object?)?.toString();
      if (open == null || high == null || low == null || close == null || t == null) continue;
      final time = DateTime.tryParse(t);
      if (time == null) continue;
      candles.add(MarketCandle(
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: _num(map['v']),
        source: MarketDataSource.alpaca,
      ));
    }
    return candles;
  }

  /// Parses one Alpaca WebSocket trade message: `{"T":"t","S":"AAPL","p":...}`.
  static MarketQuote? parseWsTrade({
    required Map<String, dynamic> json,
    required String mkrSymbol,
    required AssetClass assetClass,
  }) {
    if (json['T'] != 't') return null;
    final price = _num(json['p']);
    if (price == null) return null;
    return MarketQuote(
      symbol: mkrSymbol,
      name: mkrSymbol,
      assetClass: assetClass,
      price: price,
      changeAbs: 0,
      changePct: 0,
      source: MarketDataSource.alpaca,
      isLive: true,
    );
  }
}
