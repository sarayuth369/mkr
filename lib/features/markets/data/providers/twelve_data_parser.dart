import '../../../../domain/asset_class.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_data_source.dart';
import '../../../../domain/market_quote.dart';
import '../../../../domain/market_session_status.dart';

/// Pure JSON parsing for the MKR backend's normalized market-data envelope
/// (`{"success": true, "data": ...}` — see `backend/src/types.ts`
/// `NormalizedQuote`/`NormalizedCandle`/`NormalizedMarketStatus`). The
/// backend gateway — not Flutter — talks to Twelve Data/Alpaca and does the
/// provider-specific parsing server-side; this class only ever sees MKR's
/// own normalized shape, never a raw provider response. Kept as its own
/// class (rather than folded into the provider) so it stays unit-testable
/// against fixture JSON with no live connection.
class TwelveDataParser {
  const TwelveDataParser._();

  static bool isErrorEnvelope(Map<String, dynamic> json) => json['success'] == false;

  static bool isRateLimited(Map<String, dynamic> json) {
    if (!isErrorEnvelope(json)) return false;
    final code = (json['error'] as Map?)?['code'];
    return code == 'PROVIDER_RATE_LIMIT' || code == 'RATE_LIMITED';
  }

  static double? _num(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Unwraps the `{"success": true, "data": ...}` envelope. Returns `null`
  /// for an error envelope or a malformed/missing body — never throws.
  static Map<String, dynamic>? _unwrapData(Map<String, dynamic> json) {
    if (isErrorEnvelope(json)) return null;
    final data = json['data'];
    return data is Map<String, dynamic> ? data : null;
  }

  /// Parses a `GET /api/mkr/market/quote` response body into a [MarketQuote]
  /// for [mkrSymbol]/[assetClass]. Returns `null` for an error envelope, a
  /// `data: null` body (a genuinely healthy-but-empty result — e.g. an
  /// unsupported symbol on this deployment), or a body missing the one
  /// field that can't be sensibly defaulted (the price).
  static MarketQuote? parseQuote({
    required Map<String, dynamic> json,
    required String mkrSymbol,
    required AssetClass assetClass,
  }) {
    if (isErrorEnvelope(json)) return null;
    final data = json['data'];
    if (data is! Map<String, dynamic>) return null;

    final price = _num(data['price']);
    if (price == null) return null;

    return MarketQuote(
      symbol: mkrSymbol,
      name: (data['name'] as Object?)?.toString() ?? mkrSymbol,
      assetClass: assetClass,
      price: price,
      changeAbs: _num(data['change']) ?? 0.0,
      changePct: _num(data['changePercent']) ?? 0.0,
      high: _num(data['high']),
      low: _num(data['low']),
      open: _num(data['open']),
      prevClose: _num(data['previousClose']),
      volume: _num(data['volume']),
      bid: _num(data['bid']),
      ask: _num(data['ask']),
      currency: (data['currency'] as Object?)?.toString() ?? 'USD',
      source: _sourceOf(data['source']),
      isLive: data['isLive'] == true,
      sessionStatus: _sessionStatusOf(data['sessionStatus']),
    );
  }

  /// Parses a `GET /api/mkr/market/candles` response body (`data` is an
  /// already oldest-first array — the backend does the reordering) into
  /// [MarketCandle]s. Returns an empty list (never fabricated bars) for an
  /// error envelope or a non-list `data`.
  static List<MarketCandle> parseCandles(Map<String, dynamic> json) {
    final data = _unwrapDataList(json);
    if (data == null) return const [];

    final candles = <MarketCandle>[];
    for (final entry in data) {
      if (entry is! Map) continue;
      final map = entry.cast<String, dynamic>();
      final open = _num(map['open']);
      final high = _num(map['high']);
      final low = _num(map['low']);
      final close = _num(map['close']);
      final timestamp = map['timestamp'];
      if (open == null || high == null || low == null || close == null || timestamp is! num) continue;
      candles.add(MarketCandle(
        time: DateTime.fromMillisecondsSinceEpoch(timestamp.toInt()),
        open: open,
        high: high,
        low: low,
        close: close,
        volume: _num(map['volume']),
        source: _sourceOf(map['source']),
      ));
    }
    return candles;
  }

  static List<dynamic>? _unwrapDataList(Map<String, dynamic> json) {
    if (isErrorEnvelope(json)) return null;
    final data = json['data'];
    return data is List ? data : null;
  }

  /// Parses a `GET /api/mkr/market/status` response body.
  static MarketSessionStatus parseMarketStatus(Map<String, dynamic> json) {
    final data = _unwrapData(json);
    return _sessionStatusOf(data?['session']) ?? MarketSessionStatus.unknown;
  }

  /// Parses one normalized WebSocket tick frame pushed by
  /// `/api/mkr/market/stream`: `{"symbol", "price", "timestamp", "source"}`
  /// — flat, not wrapped in the HTTP success/data envelope. Returns `null`
  /// for a malformed frame (missing price) or one for a symbol this client
  /// isn't tracking (checked by the caller via [mkrSymbol]).
  static MarketQuote? parseWsTick({
    required Map<String, dynamic> json,
    required String mkrSymbol,
    required AssetClass assetClass,
  }) {
    final price = _num(json['price']);
    if (price == null) return null;
    return MarketQuote(
      symbol: mkrSymbol,
      name: mkrSymbol,
      assetClass: assetClass,
      price: price,
      changeAbs: 0,
      changePct: 0,
      source: _sourceOf(json['source']),
      isLive: true,
    );
  }

  static MarketDataSource _sourceOf(Object? value) => switch (value) {
        'twelve_data' => MarketDataSource.twelveData,
        'alpaca' => MarketDataSource.alpaca,
        _ => MarketDataSource.demo,
      };

  static MarketSessionStatus? _sessionStatusOf(Object? value) => switch (value) {
        'open' => MarketSessionStatus.open,
        'closed' => MarketSessionStatus.closed,
        'pre_market' => MarketSessionStatus.preMarket,
        'after_hours' => MarketSessionStatus.afterHours,
        'unknown' => MarketSessionStatus.unknown,
        _ => null,
      };
}
