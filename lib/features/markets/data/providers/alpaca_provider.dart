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
import 'alpaca_parser.dart';

/// The SECONDARY/standby provider. Same interface and same "calls a
/// configurable backend URL, never holds a credential" shape as
/// [TwelveDataProvider], but [healthCheck] reports `false` by default
/// ([activated] = `false`) because Alpaca Free's commercial redistribution
/// rights for MKR have not been confirmed — [MarketProviderManager] must
/// never fail over to a provider whose licensing isn't settled just because
/// it happens to be reachable.
class AlpacaProvider implements MarketDataProvider {
  AlpacaProvider({
    required this.backendBaseUrl,
    this.activated = false,
    http.Client? httpClient,
    WebSocketChannel Function(Uri uri)? webSocketFactory,
    SymbolMapper? symbolMapper,
  })  : _http = httpClient ?? http.Client(),
        _openWebSocket = webSocketFactory ?? WebSocketChannel.connect,
        _symbolMapper = symbolMapper ?? const SymbolMapper();

  @override
  final String id = 'alpaca';

  final String backendBaseUrl;

  /// Set `true` only once licensing/redistribution rights are confirmed —
  /// see the class doc comment. Left `false` for Phase 1.
  final bool activated;

  final http.Client _http;
  final WebSocketChannel Function(Uri uri) _openWebSocket;
  final SymbolMapper _symbolMapper;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _channelSubscription;
  final _quoteController = StreamController<MarketQuote>.broadcast();
  final Set<String> _subscribedSymbols = {};

  AssetClass _assetClassFor(String symbol) => MockMarketCatalog.bySymbol(symbol)?.assetClass ?? AssetClass.usStock;

  Uri _restUri(String path, Map<String, String> query) => Uri.parse('$backendBaseUrl$path').replace(queryParameters: query);

  @override
  Future<bool> healthCheck() async {
    if (!activated) return false;
    try {
      final response = await _http.get(_restUri('/api/mkr/alpaca/health', const {})).timeout(const Duration(seconds: 5));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    if (!activated) return null;
    final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.alpaca);
    if (providerSymbol == null) return null;

    try {
      final response = await _http.get(_restUri('/api/mkr/alpaca/snapshot', {'symbol': providerSymbol}));
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return null;
      return AlpacaParser.parseSnapshot(json: json, mkrSymbol: symbol, assetClass: _assetClassFor(symbol));
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
    if (!activated) return const [];
    final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.alpaca);
    if (providerSymbol == null) return const [];

    try {
      final response = await _http.get(_restUri('/api/mkr/alpaca/bars', {
        'symbol': providerSymbol,
        'timeframe': timeframe.providerInterval,
      }));
      if (response.statusCode != 200) return const [];
      final json = jsonDecode(response.body);
      if (json is! Map<String, dynamic>) return const [];
      return AlpacaParser.parseBars(json);
    } catch (_) {
      return const [];
    }
  }

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.unknown;

  @override
  Future<void> connect() async {
    if (!activated || _channel != null) return;
    try {
      final channel = _openWebSocket(Uri.parse('$backendBaseUrl/api/mkr/alpaca/stream'));
      _channel = channel;
      _channelSubscription = channel.stream.listen(_handleFrame, cancelOnError: true);
    } catch (_) {
      // Standby provider — a failed connect here must not surface as an
      // app-wide failure; the manager simply won't use this provider.
    }
  }

  void _handleFrame(dynamic raw) {
    if (raw is! String) return;
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) return;
    final providerSymbol = (decoded['S'] as Object?)?.toString();
    if (providerSymbol == null) return;
    final mkrSymbol = _mkrSymbolFor(providerSymbol);
    if (mkrSymbol == null) return;
    final quote = AlpacaParser.parseWsTrade(json: decoded, mkrSymbol: mkrSymbol, assetClass: _assetClassFor(mkrSymbol));
    if (quote != null && !_quoteController.isClosed) _quoteController.add(quote);
  }

  String? _mkrSymbolFor(String providerSymbol) {
    for (final symbol in _subscribedSymbols) {
      if (_symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.alpaca) == providerSymbol) return symbol;
    }
    return null;
  }

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    if (activated) {
      for (final symbol in symbols) {
        if (_subscribedSymbols.add(symbol)) {
          final providerSymbol = _symbolMapper.toProviderSymbol(symbol, MarketDataProviderId.alpaca);
          if (providerSymbol != null) {
            _channel?.sink.add(jsonEncode({'action': 'subscribe', 'trades': [providerSymbol]}));
          }
        }
      }
    }
    return _quoteController.stream.where((q) => symbols.contains(q.symbol));
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
    await _channelSubscription?.cancel();
    await _channel?.sink.close();
    _channel = null;
    _subscribedSymbols.clear();
  }
}
