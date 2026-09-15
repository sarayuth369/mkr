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

  group('TwelveDataProvider.getHistoricalCandles — candle element validation correction', () {
    // 2026-09-15 candle element validation correction task — a valid
    // top-level `data` array containing ONLY malformed candle entries (bad
    // OHLC/timestamp) must not be silently collapsed into the same `[]` a
    // genuinely empty array produces - TwelveDataParser.parseCandles()
    // itself still just skips unparseable entries (unchanged), so the
    // provider distinguishes the two cases using the raw pre-parse list.

    test('data: [] is a genuine empty history, never an exception', () async {
      final provider = _providerFor({'success': true, 'data': []});

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, isEmpty);
    });

    test('non-empty data with every entry malformed throws MarketFetchException, never []', () async {
      final provider = _providerFor({
        'success': true,
        'data': [
          {'open': 1, 'high': 2, 'low': 0.5}, // missing close + timestamp
          {'timestamp': 1700000000000}, // missing OHLC entirely
        ],
      });

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('mixed valid + malformed entries returns only the valid candles, never throws, never fabricates', () async {
      final provider = _providerFor({
        'success': true,
        'data': [
          {'open': 1, 'high': 2, 'low': 0.5, 'close': 1.5, 'timestamp': 1700000000000},
          {'open': 1}, // malformed - missing high/low/close/timestamp
        ],
      });

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, hasLength(1));
      expect(result.single.close, 1.5);
    });
  });

  group('TwelveDataProvider.getHistoricalCandles — candle numeric validation correction', () {
    // 2026-09-15 candle numeric validation correction task — a NaN/Infinity
    // OHLC value must be treated as malformed, never accepted as a real
    // candle value. Strict JSON can't encode a literal NaN/Infinity number,
    // but a malformed backend CAN send one as a string (e.g. "NaN"), which
    // `_num()`'s string branch (`double.tryParse`) genuinely converts to a
    // non-finite double - exactly the real-wire vector this closes. (A
    // non-finite NUMERIC `timestamp` specifically can't be produced through
    // real JSON encode/decode at all - that case is covered directly
    // against the parser in twelve_data_parser_test.dart.)

    test('non-empty data where the only entry has a "NaN" OHLC string throws MarketFetchException, never []', () async {
      final provider = _providerFor({
        'success': true,
        'data': [
          {'open': 'NaN', 'high': 2, 'low': 0.5, 'close': 1.5, 'timestamp': 1700000000000},
        ],
      });

      await expectLater(
        provider.getHistoricalCandles('AAPL', Timeframe.d1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('mixed valid + non-finite ("Infinity") entries returns only the valid candle', () async {
      final provider = _providerFor({
        'success': true,
        'data': [
          {'open': 1, 'high': 2, 'low': 0.5, 'close': 1.5, 'timestamp': 1700000000000},
          {'open': 'Infinity', 'high': 3, 'low': 1, 'close': 2.5, 'timestamp': 1700086400000},
        ],
      });

      final result = await provider.getHistoricalCandles('AAPL', Timeframe.d1);

      expect(result, hasLength(1));
      expect(result.single.close, 1.5);
    });
  });
}
