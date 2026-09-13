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

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    try {
      final response = await _http.get(_restUri('/api/mkr/market/quote', {'symbol': symbol}));
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return null;
      return TwelveDataParser.parseQuote(json: json, mkrSymbol: symbol, assetClass: _assetClassFor(symbol));
    } catch (_) {
      return null;
    }
  }

  /// ONE request for every requested symbol via the backend's batch
  /// endpoint — calling [getQuote] per symbol here (even concurrently) would
  /// mean N individual REST calls for a client's full catalog load, which
  /// exhausts Twelve Data Free's rate limit almost immediately (confirmed
  /// live: every quote came back PROVIDER_UNAVAILABLE under that load).
  @override
  Future<List<MarketQuote>> getQuotes(List<String> symbols) async {
    if (symbols.isEmpty) return const [];
    try {
      final response = await _http.get(_restUri('/api/mkr/market/quotes', {'symbols': symbols.join(',')}));
      if (response.statusCode != 200) return const [];
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return const [];
      return TwelveDataParser.parseQuotesBatch(json: json, assetClassFor: _assetClassFor);
    } catch (_) {
      return const [];
    }
  }

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async {
    try {
      final response = await _http.get(_restUri('/api/mkr/market/candles', {
        'symbol': symbol,
        'interval': timeframe.name,
      }));
      if (response.statusCode != 200) return const [];
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return const [];
      return TwelveDataParser.parseCandles(json);
    } catch (_) {
      return const [];
    }
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
