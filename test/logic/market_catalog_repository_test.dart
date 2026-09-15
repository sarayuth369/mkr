import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/features/markets/data/market_catalog_repository.dart';

// 2026-09-15 frontend hardening task: MarketCatalogRepository is the "backend
// market catalog -> Flutter catalog/symbol registry" step the mandated
// architecture requires - production Flutter must request only symbols the
// backend currently has enabled, never MockMarketCatalog.

http.Response _jsonResponse(Object body, {int status = 200}) => http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

void main() {
  group('MarketCatalogRepository.load', () {
    test('parses a well-formed catalog response, preserving canonical symbol formats (BTC and XAU/USD)', () async {
      final client = MockClient((request) async => _jsonResponse({
            'success': true,
            'data': [
              {'symbol': 'XAU/USD', 'displayName': 'Gold Spot', 'category': 'gold', 'featured': true, 'sortOrder': 0, 'defaultTimeframe': 'd1'},
              {'symbol': 'BTC', 'displayName': 'Bitcoin', 'category': 'crypto', 'featured': true, 'sortOrder': 30, 'defaultTimeframe': 'd1'},
            ],
          }));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final symbols = await repo.load();

      expect(symbols.map((s) => s.symbol), containsAll(['XAU/USD', 'BTC']));
      final xau = symbols.firstWhere((s) => s.symbol == 'XAU/USD');
      expect(xau.assetClass, AssetClass.gold);
      final btc = symbols.firstWhere((s) => s.symbol == 'BTC');
      expect(btc.assetClass, AssetClass.crypto);
    });

    test('dedupes a repeated symbol, keeping the first occurrence', () async {
      final client = MockClient((request) async => _jsonResponse({
            'success': true,
            'data': [
              {'symbol': 'AAPL', 'displayName': 'Apple (first)', 'category': 'us_stock', 'featured': false, 'sortOrder': 1},
              {'symbol': 'AAPL', 'displayName': 'Apple (duplicate)', 'category': 'us_stock', 'featured': false, 'sortOrder': 2},
            ],
          }));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final symbols = await repo.load();

      expect(symbols, hasLength(1));
      expect(symbols.single.displayName, 'Apple (first)');
    });

    test('rejects an entry with an unrecognized category rather than guessing an AssetClass', () async {
      final client = MockClient((request) async => _jsonResponse({
            'success': true,
            'data': [
              {'symbol': 'GOOD', 'displayName': 'Good', 'category': 'us_stock', 'featured': false, 'sortOrder': 1},
              {'symbol': 'FUTURE_CATEGORY', 'displayName': 'Bad', 'category': 'something_new', 'featured': false, 'sortOrder': 2},
            ],
          }));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final symbols = await repo.load();

      expect(symbols.map((s) => s.symbol), ['GOOD']);
    });

    test('rejects an entry with a missing or blank symbol', () async {
      final client = MockClient((request) async => _jsonResponse({
            'success': true,
            'data': [
              {'displayName': 'No symbol', 'category': 'us_stock'},
              {'symbol': '   ', 'displayName': 'Blank symbol', 'category': 'us_stock'},
              {'symbol': 'GOOD', 'displayName': 'Good', 'category': 'us_stock'},
            ],
          }));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final symbols = await repo.load();

      expect(symbols.map((s) => s.symbol), ['GOOD']);
    });

    test('an empty catalog is a valid, honest empty result - not an exception', () async {
      final client = MockClient((request) async => _jsonResponse({'success': true, 'data': []}));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      expect(await repo.load(), isEmpty);
    });

    test('throws MarketCatalogException on a non-200 response - never silently substitutes a fallback catalog', () async {
      final client = MockClient((request) async => _jsonResponse({'error': 'nope'}, status: 500));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(repo.load(), throwsA(isA<MarketCatalogException>()));
    });

    test('throws MarketCatalogException on a malformed body', () async {
      final client = MockClient((request) async => http.Response('not json', 200));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(repo.load(), throwsA(isA<MarketCatalogException>()));
    });

    test('throws MarketCatalogException when the HTTP call itself fails (offline)', () async {
      final client = MockClient((request) async => throw Exception('socket closed'));
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(repo.load(), throwsA(isA<MarketCatalogException>()));
    });

    test('concurrent callers share the same in-flight request (client-side single-flight)', () async {
      var calls = 0;
      final client = MockClient((request) async {
        calls++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return _jsonResponse({
          'success': true,
          'data': [
            {'symbol': 'AAPL', 'displayName': 'Apple', 'category': 'us_stock'},
          ],
        });
      });
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await Future.wait([repo.load(), repo.load(), repo.load()]);

      expect(calls, 1);
    });

    test('a cached result is served without a second HTTP call until forceRefresh is requested', () async {
      var calls = 0;
      final client = MockClient((request) async {
        calls++;
        return _jsonResponse({
          'success': true,
          'data': [
            {'symbol': 'AAPL', 'displayName': 'Apple', 'category': 'us_stock'},
          ],
        });
      });
      final repo = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await repo.load();
      await repo.load();
      expect(calls, 1);

      await repo.load(forceRefresh: true);
      expect(calls, 2);
    });
  });
}
