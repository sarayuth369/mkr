import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_session_status.dart';
import 'package:mkr/features/markets/data/market_catalog_repository.dart';
import 'package:mkr/features/markets/data/market_provider_manager.dart';
import 'package:mkr/features/markets/data/provider_backed_market_service.dart';
import 'package:mkr/features/markets/domain/market_data_provider.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

// 2026-09-15 frontend hardening task - end-to-end coverage for
// ProviderBackedMarketService: the real-mode catalog path must never
// silently fall back to MockMarketCatalog, and must request exactly the
// symbols the backend catalog currently has enabled.

http.Response _jsonResponse(Object body, {int status = 200}) => http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

class _RecordingProvider implements MarketDataProvider {
  @override
  final String id = 'fake';

  List<String>? lastRequestedSymbols;
  MarketFetchResult quotesResult = const MarketFetchEmpty();

  @override
  Future<bool> healthCheck() async => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<MarketQuote?> getQuote(String symbol) async => null;

  @override
  Future<MarketFetchResult> getQuotes(List<String> symbols) async {
    lastRequestedSymbols = symbols;
    return quotesResult;
  }

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async => const [];

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.open;

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) => const Stream.empty();

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) => const Stream.empty();
}

void main() {
  test('real mode never falls back to the mock catalog when the backend catalog fails to load - returns an honest offline failure', () async {
    final catalogClient = MockClient((request) async => _jsonResponse({'error': 'down'}, status: 500));
    final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: catalogClient);
    final provider = _RecordingProvider();
    final manager = MarketProviderManager(primary: provider);
    final service = ProviderBackedMarketService(manager, catalog);

    final result = await service.getAllQuotes();

    expect(result, isA<MarketFetchFailure>());
    expect((result as MarketFetchFailure).kind, MarketFetchFailureKind.offline);
    // The provider was never even asked for quotes - no symbols to request
    // without a real catalog, and definitely not MockMarketCatalog's list.
    expect(provider.lastRequestedSymbols, isNull);
  });

  test('getAllQuotes requests exactly the enabled backend catalog symbols, in one batch call', () async {
    final catalogClient = MockClient((request) async => _jsonResponse({
          'success': true,
          'data': [
            {'symbol': 'AAPL', 'displayName': 'Apple', 'category': 'us_stock', 'sortOrder': 1},
            {'symbol': 'XAU/USD', 'displayName': 'Gold Spot', 'category': 'gold', 'sortOrder': 0},
          ],
        }));
    final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: catalogClient);
    final provider = _RecordingProvider()..quotesResult = const MarketFetchSuccess([]);
    final manager = MarketProviderManager(primary: provider);
    final service = ProviderBackedMarketService(manager, catalog);

    await service.getAllQuotes();

    expect(provider.lastRequestedSymbols, containsAll(['AAPL', 'XAU/USD']));
    expect(provider.lastRequestedSymbols, hasLength(2)); // a disabled/unknown symbol was never mixed in
  });

  test('a disabled backend symbol (absent from the catalog response) is never requested', () async {
    final catalogClient = MockClient((request) async => _jsonResponse({
          'success': true,
          'data': [
            {'symbol': 'AAPL', 'displayName': 'Apple', 'category': 'us_stock'},
            // 'DXY' deliberately absent - simulates a disabled backend symbol.
          ],
        }));
    final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: catalogClient);
    final provider = _RecordingProvider()..quotesResult = const MarketFetchSuccess([]);
    final manager = MarketProviderManager(primary: provider);
    final service = ProviderBackedMarketService(manager, catalog);

    await service.getAllQuotes();

    expect(provider.lastRequestedSymbols, isNot(contains('DXY')));
  });

  test('getQuotesFor is one batch call for a caller-supplied symbol list (e.g. Watchlist), never N individual calls', () async {
    final catalog = MarketCatalogRepository(backendBaseUrl: 'https://unused.invalid');
    final provider = _RecordingProvider()..quotesResult = MarketFetchSuccess([MarketQuote(symbol: 'AAPL', name: 'Apple', assetClass: AssetClass.usStock, price: 1, changeAbs: 0, changePct: 0)]);
    final manager = MarketProviderManager(primary: provider);
    final service = ProviderBackedMarketService(manager, catalog);

    final result = await service.getQuotesFor(['AAPL', 'MSFT', 'XAU/USD']);

    expect(provider.lastRequestedSymbols, ['AAPL', 'MSFT', 'XAU/USD']);
    expect(result, isA<MarketFetchSuccess>());
  });
}
