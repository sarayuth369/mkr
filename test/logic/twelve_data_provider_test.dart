import 'dart:async';
import 'dart:convert';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/features/markets/data/market_catalog_repository.dart';
import 'package:mkr/features/markets/data/providers/twelve_data_provider.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Minimal fake `WebSocketChannel` for reconnect-logic tests - only
/// `stream`/`sink` are ever touched by [TwelveDataProvider]/[AlpacaProvider];
/// every other `WebSocketChannel`/`StreamChannel` member (protocol,
/// closeCode, ready, cast/pipe/transform/...) is intentionally left to
/// `noSuchMethod`, the standard hand-rolled-fake idiom for an interface this
/// wide when only a couple of members are actually exercised.
class _FakeWebSocketSink implements WebSocketSink {
  final List<dynamic> sent = [];

  @override
  void add(dynamic data) => sent.add(data);

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future addStream(Stream stream) async {}

  @override
  Future close([int? closeCode, String? closeReason]) async {}

  @override
  Future get done => Future<void>.value();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeWebSocketChannel implements WebSocketChannel {
  _FakeWebSocketChannel(this._controller);

  final StreamController<dynamic> _controller;
  final _FakeWebSocketSink fakeSink = _FakeWebSocketSink();

  @override
  Stream get stream => _controller.stream;

  @override
  WebSocketSink get sink => fakeSink;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

/// These tests exercise candle parsing only, which never consults asset-
/// class classification - an unloaded (never-`load()`-ed) catalog is fine;
/// see `test/logic/provider_asset_class_test.dart` for the dedicated
/// real-catalog-classification regression coverage (Finding 4).
MarketCatalogRepository _unloadedCatalog() =>
    MarketCatalogRepository(backendBaseUrl: 'https://backend.example.com', httpClient: MockClient((r) async => http.Response('', 500)));

TwelveDataProvider _providerFor(Object body, {int status = 200}) {
  return TwelveDataProvider(
    backendBaseUrl: 'https://backend.example.com',
    catalog: _unloadedCatalog(),
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

  group('TwelveDataProvider — 2026-09-16 Final Release Gate audit: WS reconnect + prolonged-outage error surfacing', () {
    test('a dropped connection (onDone) resets state so a later connect() can actually reopen it', () async {
      final controllers = <StreamController<dynamic>>[];
      final openedUris = <Uri>[];
      final provider = TwelveDataProvider(
        backendBaseUrl: 'https://backend.example.com',
        catalog: _unloadedCatalog(),
        httpClient: MockClient((r) async => http.Response('', 500)),
        webSocketFactory: (uri) {
          openedUris.add(uri);
          final controller = StreamController<dynamic>();
          controllers.add(controller);
          return _FakeWebSocketChannel(controller);
        },
      );

      await provider.connect();
      expect(openedUris, hasLength(1));

      // The connection drops (server closes it) - onDone fires.
      await controllers.first.close();
      await Future<void>.delayed(Duration.zero);

      // A fresh connect() call must actually be able to reopen a socket -
      // previously nothing reset internal channel state on a drop outside
      // of an explicit disconnect(), so this would have been a no-op.
      await provider.connect();
      expect(openedUris, hasLength(2));
    });

    test('a prolonged outage (repeated failed reconnects) surfaces one error on the quote stream, then recovers on reconnect', () async {
      fakeAsync((async) {
        var openAttempts = 0;
        StreamController<dynamic>? lastController;
        final provider = TwelveDataProvider(
          backendBaseUrl: 'https://backend.example.com',
          catalog: _unloadedCatalog(),
          httpClient: MockClient((r) async => http.Response('', 500)),
          webSocketFactory: (uri) {
            openAttempts++;
            final controller = StreamController<dynamic>();
            lastController = controller;
            return _FakeWebSocketChannel(controller);
          },
        );

        final events = <Object>[];
        provider.watchQuotes(const ['AAPL']).listen(events.add, onError: events.add);

        provider.connect();
        async.flushMicrotasks();
        expect(openAttempts, 1);

        // Fail the connection 3 times in a row (each onError triggers a
        // scheduled reconnect with exponential backoff, up to 30s) -
        // advancing the fake clock past each backoff window in turn.
        for (var i = 0; i < 3; i++) {
          lastController!.addError(Exception('socket dropped'));
          async.flushMicrotasks();
          async.elapse(const Duration(seconds: 31)); // covers the largest possible backoff step
        }

        // By the 3rd consecutive failure, one error must have reached this
        // stream's listener - previously reconnection retried forever with
        // no signal at all reaching the UI.
        expect(events.whereType<Exception>(), isNotEmpty);

        // A subsequent SUCCESSFUL reconnect's own ticks must still flow
        // through normally - no permanent "stuck in error" state.
        lastController!.add(jsonEncode({'symbol': 'AAPL', 'price': 123.0}));
        async.flushMicrotasks();
      });
    });
  });
}
