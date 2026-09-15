import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/core/widgets/price_chart.dart';
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

  String? lastGetQuoteSymbol;
  MarketQuote? getQuoteResult;

  String? lastCandlesSymbol;
  Timeframe? lastCandlesTimeframe;
  List<MarketCandle> candlesResult = const [];

  /// Thrown by [getHistoricalCandles] when set - simulates a real fetch
  /// fault (2026-09-15 FINAL FINAL correction task, Defect 3).
  Object? candlesException;

  List<String>? lastWatchQuotesSymbols;
  Stream<MarketQuote> watchQuotesResult = const Stream.empty();

  String? lastWatchCandlesSymbol;
  Timeframe? lastWatchCandlesTimeframe;
  Stream<MarketCandle> watchCandlesResult = const Stream.empty();

  @override
  Future<bool> healthCheck() async => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    lastGetQuoteSymbol = symbol;
    return getQuoteResult;
  }

  @override
  Future<MarketFetchResult> getQuotes(List<String> symbols) async {
    lastRequestedSymbols = symbols;
    return quotesResult;
  }

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async {
    lastCandlesSymbol = symbol;
    lastCandlesTimeframe = timeframe;
    if (candlesException != null) throw candlesException!;
    return candlesResult;
  }

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.open;

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    lastWatchQuotesSymbols = symbols;
    return watchQuotesResult;
  }

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) {
    lastWatchCandlesSymbol = symbol;
    lastWatchCandlesTimeframe = timeframe;
    return watchCandlesResult;
  }
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

  group('2026-09-15 correction task 2 — getQuote never bypasses the catalog (Defect A)', () {
    test('getQuote(disabled/unknown) never calls the provider and returns null - regression 1', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'DXY' not enabled
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final result = await service.getQuote('DXY');

      expect(result, isNull);
      expect(provider.lastGetQuoteSymbol, isNull);
    });

    test('getQuote(enabled) still reaches the provider and returns the real quote - regression 5', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['XAU/USD', 'BTC']));
      final quote = MarketQuote(symbol: 'XAU/USD', name: 'Gold', assetClass: AssetClass.gold, price: 2000, changeAbs: 0, changePct: 0);
      final provider = _RecordingProvider()..getQuoteResult = quote;
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final result = await service.getQuote('XAU/USD');

      expect(provider.lastGetQuoteSymbol, 'XAU/USD');
      expect(result, quote);

      // BTC (canonical crypto format) also passes the catalog check and
      // reaches the provider untouched - canonical formats are preserved.
      final btcResult = await service.getQuote('BTC');
      expect(provider.lastGetQuoteSymbol, 'BTC');
      expect(btcResult, quote); // same stub result, just confirming the call reached the provider
    });

    test('getQuote fails honestly (never falls back to mock) when the catalog cannot be loaded - regression 4', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => _jsonResponse({'error': 'down'}, status: 500)));
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      await expectLater(
        () => service.getQuote('AAPL'),
        throwsA(isA<MarketFetchException>().having((e) => e.kind, 'kind', MarketFetchFailureKind.offline)),
      );
      expect(provider.lastGetQuoteSymbol, isNull);
    });
  });

  group('2026-09-15 correction task 2 — getPriceSeries never bypasses the catalog (Defect B)', () {
    test('getPriceSeries(disabled/unknown) never calls the provider and returns an empty series - regression 2', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'DXY' not enabled
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final series = await service.getPriceSeries('DXY', ChartTimeframe.d1);

      expect(series, isEmpty);
      expect(provider.lastCandlesSymbol, isNull);
    });

    test('getPriceSeries(enabled) still reaches the provider for real history - regression 5', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['XAU/USD']));
      final provider = _RecordingProvider()
        ..candlesResult = [
          MarketCandle(time: DateTime(2026), open: 1, high: 2, low: 0.5, close: 1.5, volume: 0),
          MarketCandle(time: DateTime(2026, 1, 2), open: 1.5, high: 2.5, low: 1, close: 2, volume: 0),
        ];
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final series = await service.getPriceSeries('XAU/USD', ChartTimeframe.d1);

      expect(provider.lastCandlesSymbol, 'XAU/USD');
      expect(series, [1.5, 2.0]);
    });

    test('getPriceSeries fails honestly (throws, never a silently-valid empty chart) when the catalog cannot be loaded - regression 4 / FINAL point 4', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => _jsonResponse({'error': 'down'}, status: 500)));
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      // 2026-09-15 FINAL correction task: a catalog LOAD failure must not
      // be indistinguishable from a genuine "no history for this symbol"
      // empty list - it now throws, exactly like getQuote already does.
      await expectLater(
        () => service.getPriceSeries('AAPL', ChartTimeframe.d1),
        throwsA(isA<MarketFetchException>().having((e) => e.kind, 'kind', MarketFetchFailureKind.offline)),
      );
      expect(provider.lastCandlesSymbol, isNull);
    });

    test('getPriceSeries also fails honestly (throws) when the PROVIDER itself faults, never a silently-valid empty chart - FINAL FINAL Defect 3', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL']));
      final provider = _RecordingProvider()..candlesException = const MarketFetchException(MarketFetchFailureKind.providerError, 'HTTP 500');
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      // Catalog-load failure was already covered above; this proves the
      // OTHER half of Defect 3 - a genuine PROVIDER fault (not just a
      // catalog outage) fetching history also surfaces honestly instead of
      // being swallowed into an empty series indistinguishable from "this
      // symbol just has no history".
      await expectLater(
        () => service.getPriceSeries('AAPL', ChartTimeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });
  });

  group('2026-09-15 correction task 2 — watchQuotes never bypasses the catalog (Defect C)', () {
    test('watchQuotes(disabled/unknown) never subscribes upstream - regression 3', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'DXY' not enabled
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final sub = service.watchQuotes(['DXY']).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastWatchQuotesSymbols, isNull);
    });

    test('watchQuotes([enabled, disabled]) subscribes only to the enabled symbol - regression 3/5', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'DXY' not enabled
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final sub = service.watchQuotes(['AAPL', 'DXY']).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastWatchQuotesSymbols, ['AAPL']);
    });

    test('watchQuotes never subscribes upstream when the catalog cannot be loaded - surfaces as a stream error, never a silent hang - regression 4 / pre-Closed-Testing audit Known Issue A', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => _jsonResponse({'error': 'down'}, status: 500)));
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      Object? receivedError;
      final sub = service.watchQuotes(['AAPL']).listen((_) {}, onError: (Object e) => receivedError = e);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastWatchQuotesSymbols, isNull);
      // A catalog load failure must not leave a listener waiting forever
      // with no event at all - it surfaces as a genuine stream error.
      expect(receivedError, isA<MarketFetchException>());
    });
  });

  group('2026-09-15 FINAL correction task — watchCandles never bypasses the catalog (point 1)', () {
    test('watchCandles(disabled/unknown) never fetches history or subscribes upstream', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL'])); // 'DXY' not enabled
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final sub = service.watchCandles('DXY', Timeframe.h1).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastCandlesSymbol, isNull); // no historical fetch
      expect(provider.lastWatchCandlesSymbol, isNull); // no live subscription
    });

    test('watchCandles(unknown) never fetches history or subscribes upstream', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL']));
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final sub = service.watchCandles('NOSUCHSYMBOL', Timeframe.h1).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastCandlesSymbol, isNull);
      expect(provider.lastWatchCandlesSymbol, isNull);
    });

    test('watchCandles(enabled) still fetches history and subscribes upstream - canonical formats intact', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['XAU/USD']));
      final seedCandle = MarketCandle(time: DateTime(2026), open: 1, high: 1, low: 1, close: 1);
      final provider = _RecordingProvider()..candlesResult = [seedCandle];
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      final updates = <List<MarketCandle>>[];
      final sub = service.watchCandles('XAU/USD', Timeframe.h1).listen(updates.add);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastCandlesSymbol, 'XAU/USD');
      expect(provider.lastWatchCandlesSymbol, 'XAU/USD');
      expect(updates, isNotEmpty);
      expect(updates.first.single.close, 1);
    });

    test('watchCandles never fetches history or subscribes upstream when the catalog cannot be loaded - surfaces as a stream error, never a silent hang - pre-Closed-Testing audit Known Issue A', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => _jsonResponse({'error': 'down'}, status: 500)));
      final provider = _RecordingProvider();
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      Object? receivedError;
      final sub = service.watchCandles('AAPL', Timeframe.h1).listen((_) {}, onError: (Object e) => receivedError = e);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(provider.lastCandlesSymbol, isNull);
      expect(provider.lastWatchCandlesSymbol, isNull);
      expect(receivedError, isA<MarketFetchException>());
    });
  });

  group('2026-09-15 FINAL FINAL correction task — watchCandles surfaces a real failure distinctly (Defect 3)', () {
    test('a genuine provider fault fetching history is surfaced as a stream error, never silently indistinguishable from empty', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL']));
      final provider = _RecordingProvider()..candlesException = const MarketFetchException(MarketFetchFailureKind.providerError, 'boom');
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      Object? receivedError;
      final updates = <List<MarketCandle>>[];
      final sub = service.watchCandles('AAPL', Timeframe.h1).listen(updates.add, onError: (Object e) => receivedError = e);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(receivedError, isA<MarketFetchException>());
      expect(updates, isEmpty); // never a fabricated/empty success event alongside the error
    });

    test('a genuinely empty history is delivered as a normal empty event, never an error', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: _catalogClientFor(['AAPL']));
      final provider = _RecordingProvider()..candlesResult = const [];
      final manager = MarketProviderManager(primary: provider);
      final service = ProviderBackedMarketService(manager, catalog);

      Object? receivedError;
      final updates = <List<MarketCandle>>[];
      final sub = service.watchCandles('AAPL', Timeframe.h1).listen(updates.add, onError: (Object e) => receivedError = e);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      expect(receivedError, isNull);
      expect(updates, isNotEmpty);
      expect(updates.first, isEmpty);
    });
  });
}
