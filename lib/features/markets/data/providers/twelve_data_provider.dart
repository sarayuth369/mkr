import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../../data/mock_market_catalog.dart';
import '../../../../domain/asset_class.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_quote.dart';
import '../../../../domain/market_session_status.dart';
import '../../domain/market_data_provider.dart';
import '../../domain/market_fetch_result.dart';
import '../../domain/timeframe.dart';
import 'twelve_data_parser.dart';

/// The PRIMARY market-data provider. Calls the MKR backend gateway
/// (`{backendBaseUrl}/api/mkr/market/*`, see `backend/README.md`) — never
/// Twelve Data directly, and never holds an API key. The backend does its
/// own Twelve-Data-primary/Alpaca-standby failover and symbol mapping
/// server-side (see `backend/src/providers/provider-manager.ts`), so this
/// class sends plain MKR symbols and only ever parses the backend's
/// normalized envelope — it has no provider-specific knowledge left.
///
/// A single shared WebSocket is used for live ticks ([watchQuotes]) so the
/// app never opens one connection per screen; the backend fans that out
/// from its own single shared upstream connection in turn.
class TwelveDataProvider implements MarketDataProvider {
  TwelveDataProvider({
    required this.backendBaseUrl,
    http.Client? httpClient,
    WebSocketChannel Function(Uri uri)? webSocketFactory,
  })  : _http = httpClient ?? http.Client(),
        _openWebSocket = webSocketFactory ?? WebSocketChannel.connect;

  @override
  final String id = 'twelveData';

  final String backendBaseUrl;
  final http.Client _http;
  final WebSocketChannel Function(Uri uri) _openWebSocket;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _channelSubscription;
  final _quoteController = StreamController<MarketQuote>.broadcast();
  final Set<String> _subscribedSymbols = {};
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool _disconnectedByUser = false;

  AssetClass _assetClassFor(String symbol) => MockMarketCatalog.bySymbol(symbol)?.assetClass ?? AssetClass.usStock;

  Uri _restUri(String path, Map<String, String> query) => Uri.parse('$backendBaseUrl$path').replace(queryParameters: query);

  /// `backendBaseUrl` is an http(s) URL (matching `--dart-define
  /// MARKET_BACKEND_BASE_URL`); WebSocket connections need ws(s). Naive
  /// string concatenation without this conversion produces an invalid
  /// `https://.../stream` URI, which throws an uncaught
  /// `WebSocketChannelException` on the web platform (confirmed live) —
  /// silently swallowed as a same-frame connect failure on IO instead,
  /// which is why this only surfaced when actually running the app.
  Uri _wsUri(String path) {
    final wsBase = backendBaseUrl.replaceFirst(RegExp(r'^http'), 'ws');
    return Uri.parse('$wsBase$path');
  }

  /// 2026-09-15 hardening task: throws [MarketFetchException] for a real
  /// fetch fault instead of silently returning `null` — `null` now means
  /// ONLY "the backend genuinely has no data for this symbol" (an error
  /// envelope, a malformed body, a timeout, or a connection failure are all
  /// real faults, never treated the same as "no data").
  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    final http.Response response;
    try {
      response = await _http.get(_restUri('/api/mkr/market/quote', {'symbol': symbol}));
    } catch (_) {
      throw const MarketFetchException(MarketFetchFailureKind.offline, 'Could not reach the market data service.');
    }
    if (response.statusCode == 429) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Market data provider rate limit reached.');
    }
    if (response.statusCode != 200) {
      throw MarketFetchException(MarketFetchFailureKind.providerError, 'Market data request failed (HTTP ${response.statusCode}).');
    }
    final dynamic json;
    try {
      json = jsonDecode(response.body);
    } catch (_) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    if (json is! Map<String, dynamic>) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    if (TwelveDataParser.isErrorEnvelope(json)) {
      final message = (json['error'] as Map?)?['message']?.toString() ?? 'The market data provider is currently unavailable.';
      throw MarketFetchException(MarketFetchFailureKind.providerError, message);
    }
    return TwelveDataParser.parseQuote(json: json, mkrSymbol: symbol, assetClass: _assetClassFor(symbol));
  }

  /// ONE request for every requested symbol via the backend's batch
  /// endpoint — calling [getQuote] per symbol here (even concurrently) would
  /// mean N individual REST calls for a client's full catalog load, which
  /// exhausts Twelve Data Free's rate limit almost immediately (confirmed
  /// live: every quote came back PROVIDER_UNAVAILABLE under that load).
  ///
  /// 2026-09-15 hardening task: never returns a bare empty list for a real
  /// fetch fault — see [MarketFetchResult]/[TwelveDataParser.parseQuotesBatchResult].
  @override
  Future<MarketFetchResult> getQuotes(List<String> symbols) async {
    if (symbols.isEmpty) return const MarketFetchEmpty();
    final http.Response response;
    try {
      response = await _http.get(_restUri('/api/mkr/market/quotes', {'symbols': symbols.join(',')}));
    } catch (_) {
      return const MarketFetchFailure(MarketFetchFailureKind.offline, 'Could not reach the market data service.');
    }
    if (response.statusCode == 429) {
      return const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Market data provider rate limit reached.');
    }
    if (response.statusCode != 200) {
      return MarketFetchFailure(MarketFetchFailureKind.providerError, 'Market data request failed (HTTP ${response.statusCode}).');
    }
    final dynamic json;
    try {
      json = jsonDecode(response.body);
    } catch (_) {
      return const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    if (json is! Map<String, dynamic>) {
      return const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    return TwelveDataParser.parseQuotesBatchResult(json: json, assetClassFor: _assetClassFor);
  }

  /// 2026-09-15 FINAL FINAL correction task (Defect 3): matches [getQuote]'s
  /// contract exactly — throws [MarketFetchException] for a real fetch
  /// fault instead of silently swallowing it into `[]`, which was
  /// previously indistinguishable from a genuine "no history" outcome.
  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async {
    final http.Response response;
    try {
      response = await _http.get(_restUri('/api/mkr/market/candles', {
        'symbol': symbol,
        'interval': timeframe.name,
      }));
    } catch (_) {
      throw const MarketFetchException(MarketFetchFailureKind.offline, 'Could not reach the market data service.');
    }
    if (response.statusCode != 200) {
      throw MarketFetchException(MarketFetchFailureKind.providerError, 'Market data request failed (HTTP ${response.statusCode}).');
    }
    final dynamic json;
    try {
      json = jsonDecode(response.body);
    } catch (_) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    if (json is! Map<String, dynamic>) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    // 2026-09-15 candle envelope correction: an HTTP 200 error envelope or a
    // non-list `data` must not silently become "genuine empty history" -
    // [TwelveDataParser.parseCandles] intentionally still returns `[]` for
    // both (used elsewhere to keep the parser itself simple/never-throwing),
    // so the envelope is validated HERE, before the parser ever sees it -
    // the smallest fix that closes the gap without changing the parser's
    // existing, still-relied-upon "never throws" contract.
    if (TwelveDataParser.isErrorEnvelope(json)) {
      final message = (json['error'] as Map?)?['message']?.toString() ?? 'The market data provider is currently unavailable.';
      throw MarketFetchException(MarketFetchFailureKind.providerError, message);
    }
    final rawData = json['data'];
    if (rawData is! List) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Received a malformed response from the market data service.');
    }
    final candles = TwelveDataParser.parseCandles(json);
    // 2026-09-15 candle element validation correction: [TwelveDataParser.parseCandles]
    // intentionally skips (never throws on) an entry missing OHLC/timestamp
    // - that keeps the parser simple, but on its own left a non-empty `data`
    // array containing ONLY malformed entries indistinguishable from a
    // genuinely empty one, since both collapse to `[]`. The provider
    // already has the raw (pre-parse) list right here, so it - not the
    // parser - is what distinguishes them: `rawData` empty means genuine
    // empty history (`[]`, unchanged); `rawData` non-empty but `candles`
    // empty means every entry was unparseable, a real fetch fault. A mixed
    // list (some valid, some malformed) still returns just the valid
    // candles - never fabricated, matching the existing per-entry
    // validation `parseCandles` already does.
    if (rawData.isNotEmpty && candles.isEmpty) {
      throw const MarketFetchException(MarketFetchFailureKind.providerError, 'Received a market data response with no valid candle entries.');
    }
    return candles;
  }

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async {
    try {
      final response = await _http.get(_restUri('/api/mkr/market/status', {'symbol': market}));
      if (response.statusCode != 200) return MarketSessionStatus.unknown;
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return MarketSessionStatus.unknown;
      return TwelveDataParser.parseMarketStatus(json);
    } catch (_) {
      return MarketSessionStatus.unknown;
    }
  }

  @override
  Future<bool> healthCheck() async {
    try {
      final response = await _http.get(_restUri('/api/mkr/market/health', const {})).timeout(const Duration(seconds: 5));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> connect() async {
    _disconnectedByUser = false;
    if (_channel != null) return;
    _openSocket();
  }

  void _openSocket() {
    try {
      final channel = _openWebSocket(_wsUri('/api/mkr/market/stream'));
      _channel = channel;
      _reconnectAttempt = 0;
      _channelSubscription = channel.stream.listen(
        _handleFrame,
        onError: (Object _) => _scheduleReconnect(),
        onDone: _scheduleReconnect,
        cancelOnError: true,
      );
      // Re-subscribe to whatever symbols were already wanted before a
      // reconnect, so callers of watchQuotes don't have to re-subscribe.
      if (_subscribedSymbols.isNotEmpty) _sendSubscribe(_subscribedSymbols.toList());
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _handleFrame(dynamic raw) {
    if (raw is! String) return;
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) return;
    final mkrSymbol = (decoded['symbol'] as Object?)?.toString();
    if (mkrSymbol == null || !_subscribedSymbols.contains(mkrSymbol)) return;
    final quote = TwelveDataParser.parseWsTick(json: decoded, mkrSymbol: mkrSymbol, assetClass: _assetClassFor(mkrSymbol));
    if (quote != null && !_quoteController.isClosed) _quoteController.add(quote);
  }

  void _scheduleReconnect() {
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _channel = null;
    if (_disconnectedByUser) return;

    _reconnectAttempt++;
    final delaySeconds = (1 << (_reconnectAttempt.clamp(0, 5))).clamp(1, 30);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: delaySeconds), _openSocket);
  }

  void _sendSubscribe(List<String> symbols) {
    _channel?.sink.add(jsonEncode({'action': 'subscribe', 'symbols': symbols}));
  }

  void _sendUnsubscribe(List<String> symbols) {
    _channel?.sink.add(jsonEncode({'action': 'unsubscribe', 'symbols': symbols}));
  }

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    final newSymbols = symbols.where(_subscribedSymbols.add).toList();
    if (newSymbols.isNotEmpty) _sendSubscribe(newSymbols);
    return _quoteController.stream.where((q) => symbols.contains(q.symbol));
  }

  /// Drops a symbol from the shared subscription once nothing on screen
  /// still needs it, so the backend stream doesn't keep pushing ticks no
  /// one is listening to.
  void unsubscribe(String symbol) {
    if (_subscribedSymbols.remove(symbol)) _sendUnsubscribe([symbol]);
  }

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) {
    return watchQuotes([symbol]).map((quote) => MarketCandle(
          time: DateTime.now(),
          open: quote.price,
          high: quote.price,
          low: quote.price,
          close: quote.price,
          source: quote.source,
        ));
  }

  @override
  Future<void> disconnect() async {
    _disconnectedByUser = true;
    _reconnectTimer?.cancel();
    await _channelSubscription?.cancel();
    await _channel?.sink.close();
    _channel = null;
    _subscribedSymbols.clear();
  }
}
