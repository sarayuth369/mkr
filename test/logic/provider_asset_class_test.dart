import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/features/markets/data/market_catalog_repository.dart';
import 'package:mkr/features/markets/data/providers/alpaca_provider.dart';
import 'package:mkr/features/markets/data/providers/twelve_data_provider.dart';

// 2026-09-15 post-audit task (Finding 4) — TwelveDataProvider/AlpacaProvider
// must classify a symbol's AssetClass from the real backend catalog
// (MarketCatalogRepository), never MockMarketCatalog. A symbol the backend
// catalog enables but the mock registry never happened to carry was
// previously silently misclassified as AssetClass.usStock by default,
// including for live quotes. These tests prove classification now comes
// from the real, currently-loaded catalog.

http.Response _catalogResponse(List<Map<String, Object?>> symbols) => http.Response(
      jsonEncode({'success': true, 'data': symbols}),
      200,
      headers: const {'content-type': 'application/json'},
    );

http.Response _quoteResponse(String symbol, double price) => http.Response(
      jsonEncode({
        'success': true,
        'data': {'symbol': symbol, 'price': price},
      }),
      200,
      headers: const {'content-type': 'application/json'},
    );

void main() {
  group('TwelveDataProvider — real-catalog asset-class classification', () {
    test('a symbol absent from MockMarketCatalog is classified from the real backend catalog, not defaulted to usStock', () async {
      final catalog = MarketCatalogRepository(
        backendBaseUrl: 'https://backend.example.com',
        httpClient: MockClient((request) async => _catalogResponse([
              {'symbol': 'ZZZCOIN', 'displayName': 'Test Coin', 'category': 'crypto'},
            ])),
      );
      // Warm the cache, matching real-world call order: the catalog-
      // authorization check in ProviderBackedMarketService always awaits
      // MarketCatalogRepository.load() before the provider is ever asked
      // to fetch/parse a quote.
      await catalog.load();

      final provider = TwelveDataProvider(
        backendBaseUrl: 'https://backend.example.com',
        catalog: catalog,
        httpClient: MockClient((request) async => _quoteResponse('ZZZCOIN', 123.45)),
      );

      final quote = await provider.getQuote('ZZZCOIN');

      expect(quote, isNotNull);
      expect(quote!.assetClass, AssetClass.crypto); // real catalog classification, never the usStock default
    });

    test('an unloaded catalog falls back to usStock honestly - never a fabricated classification claim', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => http.Response('', 500)));
      final provider = TwelveDataProvider(
        backendBaseUrl: 'https://backend.example.com',
        catalog: catalog,
        httpClient: MockClient((request) async => _quoteResponse('AAPL', 100.0)),
      );

      final quote = await provider.getQuote('AAPL');

      expect(quote!.assetClass, AssetClass.usStock); // last-resort fallback only, not sourced from anywhere real
    });
  });

  group('AlpacaProvider — real-catalog asset-class classification', () {
    test('classification is sourced from the real backend catalog, not MockMarketCatalog', () async {
      // BTC genuinely is crypto in MockMarketCatalog too - deliberately
      // stubbed here as a DIFFERENT category purely to prove the SOURCE has
      // changed (the real catalog now wins), since every symbol Alpaca's
      // SymbolMapper covers also happens to already exist in the mock
      // registry with the same category in practice.
      final catalog = MarketCatalogRepository(
        backendBaseUrl: 'https://backend.example.com',
        httpClient: MockClient((request) async => _catalogResponse([
              {'symbol': 'BTC', 'displayName': 'Bitcoin', 'category': 'forex'},
            ])),
      );
      await catalog.load();

      final provider = AlpacaProvider(
        backendBaseUrl: 'https://backend.example.com',
        catalog: catalog,
        activated: true,
        httpClient: MockClient((request) async => http.Response(
              jsonEncode({
                'latestTrade': {'p': 50000.0},
              }),
              200,
              headers: const {'content-type': 'application/json'},
            )),
      );

      final quote = await provider.getQuote('BTC');

      expect(quote, isNotNull);
      expect(quote!.assetClass, AssetClass.forex); // followed the stubbed real-catalog category, not mock's "crypto"
    });

    test('an unloaded catalog falls back to usStock honestly - never a fabricated classification claim', () async {
      final catalog = MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => http.Response('', 500)));
      final provider = AlpacaProvider(
        backendBaseUrl: 'https://backend.example.com',
        catalog: catalog,
        activated: true,
        httpClient: MockClient((request) async => http.Response(
              jsonEncode({
                'latestTrade': {'p': 100.0},
              }),
              200,
              headers: const {'content-type': 'application/json'},
            )),
      );

      final quote = await provider.getQuote('AAPL');

      expect(quote!.assetClass, AssetClass.usStock);
    });
  });
}
