import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/features/markets/data/providers/twelve_data_provider.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

// 2026-09-15 candle envelope correction task — Mac found that
// TwelveDataProvider.getHistoricalCandles() checked HTTP status/JSON
// parseability before calling TwelveDataParser.parseCandles(), but never
// checked the MKR envelope itself - so an HTTP 200 response shaped as an
// error envelope ({"success": false, ...}), or one whose `data` is missing
// or not a list, was silently handed to parseCandles(), which (by design,
// unchanged here) returns [] for both. That made a real fetch fault
// indistinguishable from a genuinely empty history. These tests prove the
// gap is now closed at the provider/parser boundary, exactly matching
// getQuote's already-established contract.

http.Response _jsonResponse(Object body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

TwelveDataProvider _providerFor(Object body, {int status = 200}) {
  return TwelveDataProvider(
    backendBaseUrl: 'https://backend.example.com',
    httpClient: MockClient((request) async => _jsonResponse(body, status: status)),
  );
}

void main() {
  group('TwelveDataProvider.getHistoricalCandles — candle envelope correction', () {
    test('HTTP 200 + {success:false,...} throws MarketFetchException, never []', () async {
      final provider = _providerFor({
        'success': false,
        'error': {'code': 'PROVIDER_UNAVAILABLE', 'message': 'Twelve Data is currently unavailable.'},
      });

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>().having((e) => e.message, 'message', 'Twelve Data is currently unavailable.')),
      );
    });

    test('HTTP 200 + success:true but data is a Map (non-list, malformed) throws, never []', () async {
      final provider = _providerFor({
        'success': true,
        'data': {'unexpected': 'shape'},
      });

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('HTTP 200 + data: [] is a genuine empty history, never an exception', () async {
      final provider = _providerFor({'success': true, 'data': []});

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, isEmpty);
    });

    test('a well-formed candle payload still parses correctly - unaffected by the envelope check', () async {
      final provider = _providerFor({
        'success': true,
        'data': [
          {'open': 1, 'high': 2, 'low': 0.5, 'close': 1.5, 'timestamp': 1700000000000},
        ],
      });

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, hasLength(1));
      expect(result.single.close, 1.5);
    });

    test('HTTP non-200 status still throws (unchanged pre-existing behavior)', () async {
      final provider = _providerFor({'irrelevant': true}, status: 500);

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });
  });
}
