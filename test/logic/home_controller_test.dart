import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/features/ai/data/mock_market_ai_service.dart';
import 'package:mkr/features/calendar/data/mock_economic_calendar_service.dart';
import 'package:mkr/features/home/application/home_controller.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:mkr/core/widgets/price_chart.dart';

// 2026-09-15 correction task — Defect A: HomeController._watchLiveQuotes()
// must never subscribe to a raw pulseSymbols/snapshotSymbols selection
// directly (a hard-coded second symbol authority) - only to symbols that
// actually resolved from the catalog-authorized REST fetch.

MarketQuote _quote(String symbol, double price) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.usStock,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

class _FakeMarketService implements MarketService {
  _FakeMarketService({required this.allQuotesResult, this.watchQuotesStream});

  MarketFetchResult allQuotesResult;

  /// Overrides [watchQuotes]'s returned stream when set - lets a test
  /// control exactly what the live subscription emits (or errors).
  Stream<List<MarketQuote>>? watchQuotesStream;

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  List<String>? lastWatchedSymbols;

  /// When set, each successive [getAllQuotes] call resolves from the next
  /// completer in order instead of returning [allQuotesResult] immediately -
  /// 2026-09-15 Home/Markets final user-visible audit (item 3): lets a test
  /// control exactly when each of two overlapping [HomeController.refresh]
  /// calls resolves, and in which order.
  List<Completer<MarketFetchResult>>? getAllQuotesCompleters;
  int getAllQuotesCallCount = 0;

  @override
  Future<MarketFetchResult> getAllQuotes() async {
    final completers = getAllQuotesCompleters;
    if (completers != null) {
      final completer = completers[getAllQuotesCallCount];
      getAllQuotesCallCount++;
      return completer.future;
    }
    return allQuotesResult;
  }

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => allQuotesResult;

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async => const MarketFetchEmpty();

  @override
  Future<MarketQuote?> getQuote(String symbol) async => null;

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async => const [];

  @override
  Future<MarketFetchResult> search(String query) async => const MarketFetchEmpty();

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) {
    lastWatchedSymbols = symbols;
    return watchQuotesStream ?? const Stream.empty();
  }

  @override
  Stream<List<MarketCandle>> watchCandles(String symbol, Timeframe timeframe) => const Stream.empty();

  @override
  Future<void> reconnect() async {}

  @override
  void pause() {}

  @override
  void resume() {}
}

void main() {
  group('HomeController — Defect A correction (live subscription never bypasses the catalog)', () {
    test('the live subscription only includes symbols that actually resolved from getAllQuotes, not the raw hero selection - regression 1', () async {
      // SPX and SET are deliberately absent from the "catalog" result -
      // simulates them being backend-disabled, matching production.
      final service = _FakeMarketService(
        allQuotesResult: MarketFetchSuccess([_quote('XAU/USD', 1), _quote('BTC', 2), _quote('NDX', 3), _quote('DJI', 4)]),
      );
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, isNotNull);
      expect(service.lastWatchedSymbols, isNot(contains('SPX'))); // disabled - never subscribed
      expect(service.lastWatchedSymbols, isNot(contains('SET'))); // disabled - never subscribed
      expect(service.lastWatchedSymbols, containsAll(['XAU/USD', 'BTC', 'NDX', 'DJI']));
    });

    test('featured/snapshot rows still render correctly when one desired hero symbol is absent - regression 2', () async {
      final service = _FakeMarketService(
        allQuotesResult: MarketFetchSuccess([_quote('XAU/USD', 100), _quote('BTC', 200)]), // SPX/NDX/DJI/SET absent
      );
      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final pulse = controller.pulseState.dataOrNull;
      expect(pulse, isNotNull);
      expect(pulse!.map((q) => q.symbol), ['XAU/USD', 'BTC']); // SPX honestly omitted, never fabricated
      expect(controller.gold?.symbol, 'XAU/USD');
    });

    test('no live subscription is attempted when nothing resolved at all - never subscribes to an empty guess', () async {
      final service = _FakeMarketService(allQuotesResult: MarketFetchSuccess([_quote('UNRELATED', 1)])); // none of the hero symbols present
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, isNull);
    });

    test('a provider failure never triggers a live subscription', () async {
      final service = _FakeMarketService(allQuotesResult: const MarketFetchFailure(MarketFetchFailureKind.providerError, 'boom'));
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, isNull);
    });

    test('demo mode (MockMarketService-backed) still resolves and watches every hero symbol - regression 7', () async {
      // MockMarketCatalog carries every hero symbol used by Home, so the
      // resolved-from-fetch approach preserves demo mode's existing
      // behavior without any special-casing.
      final service = _FakeMarketService(
        allQuotesResult: MarketFetchSuccess(
          [for (final s in {...HomeController.pulseSymbols, ...HomeController.snapshotSymbols}) _quote(s, 1)],
        ),
      );
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, containsAll(HomeController.pulseSymbols));
      expect(service.lastWatchedSymbols, containsAll(HomeController.snapshotSymbols));
    });
  });

  group('HomeController — 2026-09-15 pre-Closed-Testing audit', () {
    test('a live-stream error never crashes as an unhandled zone exception and preserves the already-loaded pulse/snapshot data', () async {
      final liveController = StreamController<List<MarketQuote>>();
      final service = _FakeMarketService(
        allQuotesResult: MarketFetchSuccess([_quote('XAU/USD', 100), _quote('BTC', 200)]),
        watchQuotesStream: liveController.stream,
      );
      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final pulseBefore = controller.pulseState.dataOrNull;
      expect(pulseBefore, isNotNull);

      // Previously this had no onError handler at all, so this would
      // surface only as an unhandled zone error - not caught anywhere,
      // and (depending on the test zone) could fail the test outright.
      liveController.addError(Exception('live stream broke'));
      await Future<void>.delayed(Duration.zero);

      // The already-successfully-loaded grid must still be intact - a
      // live-ticker hiccup must not wipe already-correct REST-loaded data.
      expect(controller.pulseState.dataOrNull, pulseBefore);

      await liveController.close();
    });
  });

  group('HomeController — 2026-09-15 Home/Markets final user-visible audit (item 3) — overlapping refresh() race guard', () {
    test('a slower, older refresh() call finishing after a newer one never overwrites the newer result', () async {
      final firstCall = Completer<MarketFetchResult>();
      final secondCall = Completer<MarketFetchResult>();
      final service = _FakeMarketService(
        allQuotesResult: const MarketFetchEmpty(), // unused - getAllQuotesCompleters takes over
        watchQuotesStream: const Stream.empty(),
      )..getAllQuotesCompleters = [firstCall, secondCall];

      // The constructor fires the first refresh() (consumes firstCall).
      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);

      // A second refresh() (e.g. pull-to-refresh tapped again) starts
      // before the first has resolved - consumes secondCall.
      final secondRefresh = controller.refresh();
      await Future<void>.delayed(Duration.zero);
      expect(service.getAllQuotesCallCount, 2);

      // The NEWER call resolves first with real data.
      secondCall.complete(MarketFetchSuccess([_quote('XAU/USD', 999), _quote('BTC', 999)]));
      await secondRefresh;
      await Future<void>.delayed(Duration.zero);

      expect(controller.pulseState.dataOrNull?.map((q) => q.price).toList(), [999, 999]);

      // The OLDER, slower call now finally resolves too - it must be
      // discarded, never overwriting the already-applied newer result.
      firstCall.complete(MarketFetchSuccess([_quote('XAU/USD', 1), _quote('BTC', 1)]));
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.pulseState.dataOrNull?.map((q) => q.price).toList(), [999, 999]);
    });

    test('a disposed controller never applies a still-in-flight refresh() result', () async {
      final pending = Completer<MarketFetchResult>();
      final service = _FakeMarketService(
        allQuotesResult: const MarketFetchEmpty(),
        watchQuotesStream: const Stream.empty(),
      )..getAllQuotesCompleters = [pending];

      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);

      controller.dispose();
      pending.complete(MarketFetchSuccess([_quote('XAU/USD', 1), _quote('BTC', 1)]));

      // Must not throw (e.g. notifyListeners()-after-dispose) when the
      // in-flight fetch finally resolves after disposal.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });
}
