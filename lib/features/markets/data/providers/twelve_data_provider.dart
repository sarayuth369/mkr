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
import '../market_data_config.dart';
import '../symbol_mapping.dart';
import 'twelve_data_parser.dart';

/// The PRIMARY market-data provider. Calls a configurable backend proxy
/// (never Twelve Data directly, and never holds an API key — see the
/// architecture plan's security section) at
/// `{backendBaseUrl}/api/mkr/market/*`. Until that proxy exists, every call
/// here fails honestly and [MarketProviderManager] reports
/// [MarketDataMode.offline]/[MarketDataMode.providerError] — it never
/// fabricates a quote.
///
/// REST is used for quotes/history (see [getQuote], [getHistoricalCandles]);
/// a single shared WebSocket is used for live ticks ([watchQuotes]) so the
/// app never opens one connection per screen.
class TwelveDataProvider implements MarketDataProvider {
  TwelveDataProvider({
    required this.backendBaseUrl,
    http.Client? httpClient,
    WebSocketChannel Function(Uri uri)? webSocketFactory,
    SymbolMapper? symbolMapper,
  })  : _http = httpClient ?? http.Client(),
        _openWebSocket = webSocketFactory ?? WebSocketChannel.connect,
        _symbolMapper = symbolMapper ?? const SymbolMapper();

  @override
  final String id = 'twelveData';

  final String backendBaseUrl;
  final http.Client _http;
  final WebSocketChannel Function(Uri uri) _openWebSocket;
  final SymbolMapper _symbolMapper;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _channelSubscription;
  final _quoteController = StreamController<MarketQuote>.broadcast();
  final Set<String> _subscribedSymbols = {};
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool _disconnectedByUser = false;

  AssetClass _assetClassFor(String symbol) => MockMarketCatalog.bySymbol(symbol)?.assetClass ?? AssetClass.usStock;

  Uri _restUri(String path, Map<String, String> query) => Uri.parse('$backendBaseUrl$path').replace(queryParameters: query);

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.twelveData);
    if (providerSymbol == null) return null;

    try {
      final response = await _http.get(_restUri('/api/mkr/market/quote', {'symbol': providerSymbol}));
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return null;
      return TwelveDataParser.parseQuote(json: json, mkrSymbol: symbol, assetClass: _assetClassFor(symbol));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<List<MarketQuote>> getQuotes(List<String> symbols) async {
    final results = await Future.wait(symbols.map(getQuote));
    return results.whereType<MarketQuote>().toList();
  }

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async {
    final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.twelveData);
    if (providerSymbol == null) return const [];

    try {
      final response = await _http.get(_restUri('/api/mkr/market/candles', {
        'symbol': providerSymbol,
        'interval': timeframe.providerInterval,
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
      final response = await _http.get(_restUri('/api/mkr/market/status', {'market': market}));
      if (response.statusCode != 200) return MarketSessionStatus.unknown;
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return MarketSessionStatus.unknown;
      return switch (json['status'] as Object?) {
        'open' => MarketSessionStatus.open,
        'closed' => MarketSessionStatus.closed,
        'pre-market' => MarketSessionStatus.preMarket,
        'after-hours' => MarketSessionStatus.afterHours,
        _ => MarketSessionStatus.unknown,
      };
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
      final channel = _openWebSocket(Uri.parse('$backendBaseUrl/api/mkr/market/stream'));
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
      for (final symbol in _subscribedSymbols) {
        _sendSubscribe(symbol);
      }
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _handleFrame(dynamic raw) {
    if (raw is! String) return;
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) return;
    final providerSymbol = (decoded['symbol'] as Object?)?.toString();
    if (providerSymbol == null) return;
    final mkrSymbol = _mkrSymbolFor(providerSymbol);
    if (mkrSymbol == null) return;
    final quote = TwelveDataParser.parseWsPriceEvent(json: decoded, mkrSymbol: mkrSymbol, assetClass: _assetClassFor(mkrSymbol));
    if (quote != null && !_quoteController.isClosed) _quoteController.add(quote);
  }

  String? _mkrSymbolFor(String providerSymbol) {
    for (final symbol in _subscribedSymbols) {
      if (_symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.twelveData) == providerSymbol) return symbol;
    }
    return null;
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

  void _sendSubscribe(String symbol) {
    final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.twelveData);
    if (providerSymbol == null) return;
    _channel?.sink.add(jsonEncode({'action': 'subscribe', 'symbol': providerSymbol}));
  }

  void _sendUnsubscribe(String symbol) {
    final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.twelveData);
    if (providerSymbol == null) return;
    _channel?.sink.add(jsonEncode({'action': 'unsubscribe', 'symbol': providerSymbol}));
  }

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    for (final symbol in symbols) {
      if (_subscribedSymbols.add(symbol)) _sendSubscribe(symbol);
    }
    return _quoteController.stream.where((q) => symbols.contains(q.symbol));
  }

  /// Drops a symbol from the shared subscription once nothing on screen
  /// still needs it, so the backend stream doesn't keep pushing ticks no
  /// one is listening to.
  void unsubscribe(String symbol) {
    if (_subscribedSymbols.remove(symbol)) _sendUnsubscribe(symbol);
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
