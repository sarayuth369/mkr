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

/// A stub catalog HTTP client returning exactly [enabledSymbols] as the
/// enabled backend catalog - shared by the correction-task tests below.
/// [onCall] (optional) is invoked once per real HTTP call, for tests that
/// need to assert the catalog was only fetched once (single-flight).
MockClient _catalogClientFor(List<String> enabledSymbols, {void Function()? onCall}) {
  return MockClient((request) async {
    onCall?.call();
    return _jsonResponse({
      'success': true,
      'data': [
        for (final symbol in enabledSymbols) {'symbol': symbol, 'displayName': symbol, 'category': 'us_stock'},
      ],
    });
  });
}

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
    final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL', 'MSFT', 'XAU/USD']));
    final provider = _RecordingProvider()..quotesResult = MarketFetchSuccess([MarketQuote(symbol: 'AAPL', name: 'Apple', assetClass: AssetClass.usStock, price: 1, changeAbs: 0, changePct: 0)]);
    final manager = MarketProviderManager(primary: provider);
    final service = ProviderBackedMarketService(manager, catalog);

    final result = await service.getQuotesFor(['AAPL', 'MSFT', 'XAU/USD']);

    expect(provider.lastRequestedSymbols, ['AAPL', 'MSFT', 'XAU/USD']);
    expect(result, isA<MarketFetchSuccess>());
  });

  group('2026-09-15 correction task — getQuotesFor never bypasses the catalog', () {
    test('getQuotesFor([disabled, enabled]) requests only the enabled symbol - regression 3', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // MSFT NOT in the catalog - simulates disabled
      final provider = _RecordingProvider()..quotesResult = MarketFetchSuccess([MarketQuote(symbol: 'AAPL', name: 'Apple', assetClass: AssetClass.usStock, price: 1, changeAbs: 0, changePct: 0)]);
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      await service.getQuotesFor(['MSFT', 'AAPL']);

      expect(provider.lastRequestedSymbols, ['AAPL']);
    });

    test('getQuotesFor([unknown]) never contacts the provider - regression 4', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'NOSUCHSYMBOL' not in the catalog at all
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final result = await service.getQuotesFor(['NOSUCHSYMBOL']);

      expect(provider.lastRequestedSymbols, isNull);
      expect(result, isA<MarketFetchEmpty>());
    });

    test('a saved-but-now-disabled symbol is represented as a partial result, not silently dropped or a false failure', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'DXY' was saved earlier, now disabled
      final provider = _RecordingProvider()..quotesResult = MarketFetchSuccess([MarketQuote(symbol: 'AAPL', name: 'Apple', assetClass: AssetClass.usStock, price: 1, changeAbs: 0, changePct: 0)]);
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final result = await service.getQuotesFor(['AAPL', 'DXY']);

      expect(provider.lastRequestedSymbols, ['AAPL']); // DXY never reached the provider
      expect(result, isA<MarketFetchPartial>());
      final partial = result as MarketFetchPartial;
      expect(partial.quotes.single.symbol, 'AAPL');
      expect(partial.failedSymbols, contains('DXY'));
    });

    test('getQuotesFor also fails honestly (never falls back to a mock catalog) when the backend catalog cannot be loaded', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => _jsonResponse({'error': 'down'}, status: 500)));
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final result = await service.getQuotesFor(['AAPL']);

      expect(result, isA<MarketFetchFailure>());
      expect(provider.lastRequestedSymbols, isNull);
    });

    test('a genuine provider failure on catalog-valid symbols still surfaces as MarketFetchFailure even with an unrelated filtered symbol', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL']));
      final provider = _RecordingProvider()..quotesResult = const MarketFetchFailure(MarketFetchFailureKind.providerError, 'rate limited');
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final result = await service.getQuotesFor(['AAPL', 'UNKNOWNSYMBOL']);

      expect(result, isA<MarketFetchFailure>());
    });

    test('Home + Markets + Watchlist starting concurrently never create duplicate catalog fetches or request an unauthorized symbol - regression 9', () async {
      var catalogCalls = 0;
      final catalog = MarketCatalogRepository(
        backendBaseUrl: 'https://backend.example.com',
        httpClient: _catalogClientFor(['AAPL', 'XAU/USD'], onCall: () => catalogCalls++), // 'DISABLEDSYM' deliberately not enabled
      );
      final provider = _RecordingProvider()
        ..quotesResult = MarketFetchSuccess([
          MarketQuote(symbol: 'AAPL', name: 'Apple', assetClass: AssetClass.usStock, price: 1, changeAbs: 0, changePct: 0),
          MarketQuote(symbol: 'XAU/USD', name: 'Gold', assetClass: AssetClass.gold, price: 2, changeAbs: 0, changePct: 0),
        ]);
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      // Home's getAllQuotes(), Markets' getAllQuotes(), and Watchlist's
      // getQuotesFor() (including a saved-but-now-disabled symbol) all
      // starting around the same app-startup moment.
      await Future.wait([
        service.getAllQuotes(), // Home/Markets
        service.getAllQuotes(), // the other of Home/Markets
        service.getQuotesFor(['AAPL', 'DISABLEDSYM']), // Watchlist
      ]);

      expect(catalogCalls, 1); // single-flight - the catalog itself was fetched exactly once
      expect(provider.lastRequestedSymbols, isNot(contains('DISABLEDSYM'))); // never reached the provider
    });
  });
}
