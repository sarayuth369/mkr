import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/features/markets/data/market_catalog_repository.dart';
import 'package:mkr/features/markets/data/providers/alpaca_provider.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

// 2026-09-15 candle envelope correction task — same gap as
// TwelveDataProvider: AlpacaProvider.getHistoricalCandles() checked HTTP
// status/JSON parseability before calling AlpacaParser.parseBars(), but
// never checked the Alpaca envelope itself - an HTTP 200 Alpaca error
// response, or one whose `bars` is missing/not a list, was silently handed
// to parseBars(), which (by design, unchanged here) returns [] for both.
// These tests prove the gap is now closed at the provider/parser boundary.

http.Response _jsonResponse(Object body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

/// These tests exercise candle parsing only, which never consults asset-
/// class classification - an unloaded (never-`load()`-ed) catalog is fine;
/// see `test/logic/provider_asset_class_test.dart` for the dedicated
/// real-catalog-classification regression coverage (Finding 4).
MarketCatalogRepository _unloadedCatalog() =>
    MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => http.Response('', 500)));

AlpacaProvider _activatedProviderFor(Object body) {
  return AlpacaProvider(
    backendBaseUrl: 'https://backend.example.com',
    catalog: _unloadedCatalog(),
    activated: true,
    httpClient: MockClient((request) async => _jsonResponse(body)),
  );
}

void main() {
  group('AlpacaProvider.getHistoricalCandles — candle envelope correction', () {
    test('HTTP 200 Alpaca error response throws MarketFetchException, never [] - when activated', () async {
      final provider = _activatedProviderFor({'code': 40410000, 'message': 'symbol not found'});

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>().having((e) => e.message, 'message', 'symbol not found')),
      );
    });

    test('HTTP 200 + bars: [] is a genuine empty history, never an exception', () async {
      final provider = _activatedProviderFor({'bars': []});

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, isEmpty);
    });

    test('a well-formed bars payload still parses correctly - unaffected by the envelope check', () async {
      final provider = _activatedProviderFor({
        'bars': [
          {'o': 1, 'h': 2, 'l': 0.5, 'c': 1.5, 't': '2026-01-01T00:00:00Z'},
        ],
      });

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, hasLength(1));
      expect(result.single.close, 1.5);
    });

    test('a non-activated provider still returns [] without contacting the network - unrelated to the envelope fix', () async {
      final provider = AlpacaProvider(backendBaseUrl: 'https://backend.example.com', catalog: _unloadedCatalog()); // activated defaults to false

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, isEmpty);
    });
  });

  group('AlpacaProvider.getHistoricalCandles — candle element validation correction', () {
    // 2026-09-15 candle element validation correction task — same gap as
    // TwelveDataProvider: a non-empty `bars` array containing ONLY
    // malformed entries must not be silently collapsed into the same `[]`
    // a genuinely empty array produces. AlpacaParser.parseBars() itself
    // still just skips unparseable entries (unchanged); the provider
    // distinguishes the two cases using the raw pre-parse list.

    test('bars: [] is a genuine empty history, never an exception', () async {
      final provider = _activatedProviderFor({'bars': []});

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, isEmpty);
    });

    test('non-empty bars with every entry malformed throws MarketFetchException, never []', () async {
      final provider = _activatedProviderFor({
        'bars': [
          {'o': 1, 'h': 2, 'l': 0.5}, // missing c + t
          {'t': '2026-01-01T00:00:00Z'}, // missing OHLC entirely
        ],
      });

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('mixed valid + malformed entries returns only the valid candles, never throws, never fabricates', () async {
      final provider = _activatedProviderFor({
        'bars': [
          {'o': 1, 'h': 2, 'l': 0.5, 'c': 1.5, 't': '2026-01-01T00:00:00Z'},
          {'o': 1}, // malformed - missing h/l/c/t
        ],
      });

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, hasLength(1));
      expect(result.single.close, 1.5);
    });
  });

  group('AlpacaProvider.getHistoricalCandles — candle numeric validation correction', () {
    // 2026-09-15 candle numeric validation correction task — same gap as
    // TwelveDataProvider: a NaN/Infinity OHLC value must be treated as
    // malformed. Strict JSON can't encode a literal NaN/Infinity number,
    // but a malformed backend CAN send one as a string (e.g. "NaN"), which
    // `_num()`'s string branch genuinely converts to a non-finite double.

    test('non-empty bars where the only entry has a "NaN" OHLC string throws MarketFetchException, never []', () async {
      final provider = _activatedProviderFor({
        'bars': [
          {'o': 'NaN', 'h': 2, 'l': 0.5, 'c': 1.5, 't': '2026-01-01T00:00:00Z'},
        ],
      });

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('mixed valid + non-finite ("Infinity") entries returns only the valid candle', () async {
      final provider = _activatedProviderFor({
        'bars': [
          {'o': 1, 'h': 2, 'l': 0.5, 'c': 1.5, 't': '2026-01-01T00:00:00Z'},
          {'o': 'Infinity', 'h': 3, 'l': 1, 'c': 2.5, 't': '2026-01-02T00:00:00Z'},
        ],
      });

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, hasLength(1));
      expect(result.single.close, 1.5);
    });
  });

  group('AlpacaProvider.getQuotes — Home/Markets final user-visible audit (item 4/5)', () {
    // A per-symbol MockClient: each request's ?symbol= query param picks
    // the canned response, so a batch can mix a resolving symbol with a
    // non-resolving one in the same getQuotes() call.
    AlpacaProvider providerFor(Map<String, http.Response> responseBySymbol, {bool activated = true}) {
      return AlpacaProvider(
        backendBaseUrl: 'https://backend.example.com',
        catalog: _unloadedCatalog(),
        activated: activated,
        httpClient: MockClient((request) async {
          final symbol = request.url.queryParameters['symbol'];
          final response = responseBySymbol[symbol];
          if (response == null) throw StateError('Unexpected request for symbol: $symbol');
          return response;
        }),
      );
    }

    test('every symbol resolves - a clean MarketFetchSuccess, unaffected by the reconciliation fix', () async {
      final provider = providerFor({
        'AAPL': _jsonResponse({
          'latestTrade': {'p': 150.0},
        }),
        'MSFT': _jsonResponse({
          'latestTrade': {'p': 300.0},
        }),
      });

      final result = await provider.getQuotes(['AAPL', 'MSFT']);

      expect(result, isA<MarketFetchSuccess>());
      expect((result as MarketFetchSuccess).quotes.map((q) => q.symbol), containsAll(['AAPL', 'MSFT']));
    });

    test('a null (no exception) getQuote result folds into failedSymbols, not silently dropped', () async {
      final provider = providerFor({
        'AAPL': _jsonResponse({
          'latestTrade': {'p': 150.0},
        }),
        // no `latestTrade.p` - AlpacaParser.parseSnapshot returns null, no exception thrown.
        'MSFT': _jsonResponse(<String, dynamic>{}),
      });

      final result = await provider.getQuotes(['AAPL', 'MSFT']);

      expect(result, isA<MarketFetchPartial>());
      final partial = result as MarketFetchPartial;
      expect(partial.quotes.single.symbol, 'AAPL');
      expect(partial.failedSymbols, ['MSFT']);
    });

    test('every symbol silently resolving to null becomes MarketFetchFailure, never a null-check crash', () async {
      // Proves the hardFailureKind/hardFailureMessage `??` fallback fix:
      // no MarketFetchException is ever thrown here, so without the
      // fallback this would have hit a null-check error on `!`.
      final provider = providerFor({
        'AAPL': _jsonResponse(<String, dynamic>{}),
        'MSFT': _jsonResponse(<String, dynamic>{}),
      });

      final result = await provider.getQuotes(['AAPL', 'MSFT']);

      expect(result, isA<MarketFetchFailure>());
      final failure = result as MarketFetchFailure;
      expect(failure.kind, MarketFetchFailureKind.providerError);
      expect(failure.message, isNotEmpty);
    });

    test('a thrown MarketFetchException fault is preserved as the failure reason when nothing resolves', () async {
      final provider = providerFor({
        'AAPL': _jsonResponse({'code': 40410000, 'message': 'symbol not found'}, status: 500),
      });

      final result = await provider.getQuotes(['AAPL']);

      expect(result, isA<MarketFetchFailure>());
      final failure = result as MarketFetchFailure;
      expect(failure.kind, MarketFetchFailureKind.providerError);
      expect(failure.message, contains('HTTP 500'));
    });

    test('a non-activated provider still returns MarketFetchEmpty without contacting the network', () async {
      final provider = AlpacaProvider(backendBaseUrl: 'https://backend.example.com', catalog: _unloadedCatalog()); // activated defaults to false

      final result = await provider.getQuotes(['AAPL', 'MSFT']);

      expect(result, isA<MarketFetchEmpty>());
    });

    test('an empty symbol list returns MarketFetchEmpty without contacting the network', () async {
      final provider = providerFor(const {});

      final result = await provider.getQuotes(const []);

      expect(result, isA<MarketFetchEmpty>());
    });
  });
}
