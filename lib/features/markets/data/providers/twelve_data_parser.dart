import '../../../../domain/asset_class.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_data_source.dart';
import '../../../../domain/market_quote.dart';
import '../../../../domain/market_session_status.dart';
import '../../domain/market_fetch_result.dart';

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
    return _quoteFromData(data, mkrSymbol, assetClass);
  }

  /// Parses a `GET /api/mkr/market/quotes` (plural, batch) response body
  /// into a typed [MarketFetchResult] — 2026-09-15 frontend hardening task.
  /// `data.items` is a flat array of the same normalized-quote shape as the
  /// single-quote endpoint, already resolved server-side in ONE upstream
  /// call for every requested symbol (see `backend/src/market/market-routes.ts`
  /// `handleQuotes`) — this is what [MarketProviderManager.getQuotes] must
  /// call instead of looping [parseQuote]/[getQuote] per symbol; N
  /// individual REST calls for one client's full catalog load exhausts
  /// Twelve Data Free's rate limit almost immediately (confirmed live).
  ///
  /// `data.errors` (per-symbol failures the backend already isolates - see
  /// `handleQuotes`' `{items, errors}` envelope) is now read and preserved
  /// as [MarketFetchPartial.failedSymbols] instead of being silently
  /// discarded — the exact gap that let a genuine partial/total provider
  /// failure look identical to "zero symbols matched".
  ///
  /// 2026-09-15 Home/Markets final user-visible audit (item 4/5): confirmed
  /// LIVE against the deployed backend that a requested symbol can come
  /// back in NEITHER `items` NOR `errors` at all — a `success: true`
  /// envelope that silently has nothing to say about that symbol (e.g. a
  /// batch of ~20 catalog symbols where only 2 actually resolved, with
  /// `errors: []`). Without [requestedSymbols] to reconcile against, that
  /// silent gap was invisible to this parser: a mostly-empty batch still
  /// became a misleadingly "clean" [MarketFetchSuccess], and a WHOLLY
  /// silent batch became a false [MarketFetchEmpty] — indistinguishable
  /// from "the catalog is genuinely empty", the exact "opens with no
  /// market content, no explanation" symptom this task investigates. Every
  /// symbol in [requestedSymbols] that resolved to neither a quote nor an
  /// explicit error is now folded into `failedSymbols` too — turning a
  /// silently-incomplete "success" into an honest [MarketFetchPartial], and
  /// a wholly-silent response into an honest [MarketFetchFailure] instead
  /// of a false empty state.
  static MarketFetchResult parseQuotesBatchResult({
    required Map<String, dynamic> json,
    required AssetClass Function(String symbol) assetClassFor,
    required List<String> requestedSymbols,
  }) {
    if (isErrorEnvelope(json)) {
      final message = (json['error'] as Map?)?['message']?.toString() ?? 'The market data provider is currently unavailable.';
      return MarketFetchFailure(MarketFetchFailureKind.providerError, message);
    }
    final data = json['data'];
    if (data is! Map<String, dynamic>) {
      return const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    final items = data['items'];
    if (items is! List) {
      return const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }

    final quotes = <MarketQuote>[];
    final resolvedSymbols = <String>{};
    for (final entry in items) {
      if (entry is! Map) continue;
      final map = entry.cast<String, dynamic>();
      final symbol = (map['symbol'] as Object?)?.toString();
      if (symbol == null) continue;
      final quote = _quoteFromData(map, symbol, assetClassFor(symbol));
      if (quote != null) {
        quotes.add(quote);
        resolvedSymbols.add(symbol);
      }
    }

    final failedSymbols = <String>[];
    final failedSymbolSet = <String>{};
    final errorsRaw = data['errors'];
    if (errorsRaw is List) {
      for (final entry in errorsRaw) {
        if (entry is! Map) continue;
        final symbol = (entry['symbol'] as Object?)?.toString();
        if (symbol != null && failedSymbolSet.add(symbol)) failedSymbols.add(symbol);
      }
    }
    for (final symbol in requestedSymbols) {
      if (!resolvedSymbols.contains(symbol) && failedSymbolSet.add(symbol)) {
        failedSymbols.add(symbol);
      }
    }

    if (quotes.isEmpty && failedSymbols.isEmpty) return const MarketFetchEmpty();
    if (quotes.isEmpty) {
      // Every requested symbol failed - a real fetch fault, not "zero results".
      return const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Market data is temporarily unavailable for the requested symbols.');
    }
    if (failedSymbols.isNotEmpty) return MarketFetchPartial(quotes, failedSymbols);
    return MarketFetchSuccess(quotes);
  }

  static MarketQuote? _quoteFromData(Map<String, dynamic> data, String mkrSymbol, AssetClass assetClass) {
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
      // 2026-09-15 candle numeric validation correction: NaN/Infinity are
      // rejected here (not in the shared `_num()` helper, which quote
      // parsing also uses and stays untouched - out of scope for this fix)
      // - a non-finite OHLC value, or a non-finite numeric `timestamp`
      // (which would otherwise reach DateTime.fromMillisecondsSinceEpoch
      // with a garbage/overflowing int from `.toInt()`), is treated as a
      // malformed entry exactly like a missing field already was.
      if (open == null ||
          high == null ||
          low == null ||
          close == null ||
          !open.isFinite ||
          !high.isFinite ||
          !low.isFinite ||
          !close.isFinite ||
          timestamp is! num ||
          !timestamp.isFinite) {
        continue;
      }
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
