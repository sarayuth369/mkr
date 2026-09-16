import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/network/api_state.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_symbol_info.dart';
import 'package:mkr/features/ai/data/mock_market_ai_service.dart';
import 'package:mkr/features/calendar/data/mock_economic_calendar_service.dart';
import 'package:mkr/features/home/application/home_controller.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:mkr/core/widgets/price_chart.dart';

// 2026-09-16 post-phone Closed Testing correction task (root cause): Home
// no longer calls MarketService.getAllQuotes() (the whole catalog) - it
// calls getCatalog() (no provider cost) then ONE getQuotesFor() call for a
// small catalog-derived set (featured symbols first, filled to a small
// limit by catalog order). These tests exercise that selection + the
// existing rule that _watchLiveQuotes() must never subscribe to a raw
// selection directly - only to symbols that actually resolved.

MarketQuote _quote(String symbol, double price, {AssetClass assetClass = AssetClass.usStock}) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: assetClass,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

MarketSymbolInfo _symbol(String symbol, {required int sortOrder, bool featured = false, AssetClass assetClass = AssetClass.usStock}) =>
    MarketSymbolInfo(symbol: symbol, displayName: symbol, assetClass: assetClass, featured: featured, sortOrder: sortOrder);

class _FakeMarketService implements MarketService {
  _FakeMarketService({this.catalog = const [], this.quotesForResult = const MarketFetchEmpty(), this.watchQuotesStream});

  List<MarketSymbolInfo> catalog;
  MarketFetchResult quotesForResult;

  /// Overrides [watchQuotes]'s returned stream when set - lets a test
  /// control exactly what the live subscription emits (or errors).
  Stream<List<MarketQuote>>? watchQuotesStream;

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  List<String>? lastWatchedSymbols;
  List<String>? lastRequestedSymbols;

  /// When set, each successive [getQuotesFor] call resolves from the next
  /// completer in order instead of returning [quotesForResult] immediately -
  /// 2026-09-15 Home/Markets final user-visible audit (item 3): lets a test
  /// control exactly when each of two overlapping [HomeController.refresh]
  /// calls resolves, and in which order.
  List<Completer<MarketFetchResult>>? getQuotesForCompleters;
  int getQuotesForCallCount = 0;

  @override
  Future<List<MarketSymbolInfo>> getCatalog() async => catalog;

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty(); // unused by HomeController - see market_service.dart's doc comment

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async {
    lastRequestedSymbols = symbols;
    final completers = getQuotesForCompleters;
    if (completers != null) {
      final completer = completers[getQuotesForCallCount];
      getQuotesForCallCount++;
      return completer.future;
    }
    getQuotesForCallCount++;
    return quotesForResult;
  }

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
  group('HomeController — catalog-derived request set (2026-09-16 post-phone correction task)', () {
    test('the requested set is the catalog\'s featured symbols first, filled to the snapshot limit by sortOrder', () async {
      final service = _FakeMarketService(
        catalog: [
          _symbol('AAPL', sortOrder: 5),
          _symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold),
          _symbol('MSFT', sortOrder: 6),
          _symbol('BTC', sortOrder: 1, featured: true, assetClass: AssetClass.crypto),
          _symbol('NVDA', sortOrder: 2, featured: true),
          _symbol('AMZN', sortOrder: 7),
          _symbol('GOOGL', sortOrder: 8), // beyond the snapshot limit (6) - excluded
        ],
      );
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);

      expect(service.lastRequestedSymbols, ['XAU/USD', 'BTC', 'NVDA', 'AAPL', 'MSFT', 'AMZN']);
    });

    test('the live subscription only includes symbols that actually resolved from getQuotesFor, not every requested one', () async {
      final service = _FakeMarketService(
        catalog: [
          _symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold),
          _symbol('BTC', sortOrder: 1, featured: true, assetClass: AssetClass.crypto),
          _symbol('NVDA', sortOrder: 2, featured: true),
          _symbol('AAPL', sortOrder: 3),
        ],
        quotesForResult: MarketFetchPartial(
          [_quote('XAU/USD', 1), _quote('BTC', 2), _quote('NVDA', 3), _quote('AAPL', 4)],
          const [],
        ),
      );
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, isNotNull);
      expect(service.lastWatchedSymbols, containsAll(['XAU/USD', 'BTC', 'NVDA', 'AAPL']));
    });

    test('a requested symbol that did not resolve is never subscribed to live, and is honestly omitted from pulse/snapshot', () async {
      final service = _FakeMarketService(
        catalog: [
          _symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold),
          _symbol('BTC', sortOrder: 1, featured: true, assetClass: AssetClass.crypto),
        ],
        quotesForResult: MarketFetchPartial([_quote('XAU/USD', 100, assetClass: AssetClass.gold)], const ['BTC']),
      );
      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final pulse = controller.pulseState.dataOrNull;
      expect(pulse, isNotNull);
      expect(pulse!.map((q) => q.symbol), ['XAU/USD']); // BTC honestly omitted, never fabricated
      expect(controller.pulseState.isPartial, isTrue);
      expect(controller.gold?.symbol, 'XAU/USD');
      expect(service.lastWatchedSymbols, isNot(contains('BTC')));
    });

    test('no live subscription is attempted when nothing resolved at all - never subscribes to an empty guess', () async {
      final service = _FakeMarketService(
        catalog: [_symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold)],
        quotesForResult: const MarketFetchEmpty(),
      );
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, isNull);
    });

    test('a provider failure never triggers a live subscription', () async {
      final service = _FakeMarketService(
        catalog: [_symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold)],
        quotesForResult: const MarketFetchFailure(MarketFetchFailureKind.providerError, 'boom'),
      );
      HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.lastWatchedSymbols, isNull);
    });

    test('a catalog-load failure surfaces as ApiState.error for both pulse and snapshot', () async {
      final service = _CatalogThrowingMarketService();
      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);

      expect(controller.pulseState, isA<ApiError<List<MarketQuote>>>());
      expect(controller.snapshotState, isA<ApiError<List<MarketQuote>>>());
    });
  });

  group('HomeController — 2026-09-15 pre-Closed-Testing audit', () {
    test('a live-stream error never crashes as an unhandled zone exception and preserves the already-loaded pulse/snapshot data', () async {
      final liveController = StreamController<List<MarketQuote>>();
      final service = _FakeMarketService(
        catalog: [
          _symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold),
          _symbol('BTC', sortOrder: 1, featured: true, assetClass: AssetClass.crypto),
        ],
        quotesForResult: MarketFetchSuccess([_quote('XAU/USD', 100), _quote('BTC', 200)]),
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
        catalog: [
          _symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold),
          _symbol('BTC', sortOrder: 1, featured: true, assetClass: AssetClass.crypto),
        ],
        watchQuotesStream: const Stream.empty(),
      )..getQuotesForCompleters = [firstCall, secondCall];

      // The constructor fires the first refresh() (consumes firstCall).
      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);

      // A second refresh() (e.g. pull-to-refresh tapped again) starts
      // before the first has resolved - consumes secondCall.
      final secondRefresh = controller.refresh();
      await Future<void>.delayed(Duration.zero);
      expect(service.getQuotesForCallCount, 2);

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
        catalog: [_symbol('XAU/USD', sortOrder: 0, featured: true, assetClass: AssetClass.gold)],
        watchQuotesStream: const Stream.empty(),
      )..getQuotesForCompleters = [pending];

      final controller = HomeController(marketService: service, aiService: MockMarketAIService(), calendarService: MockEconomicCalendarService());
      await Future<void>.delayed(Duration.zero);

      controller.dispose();
      pending.complete(MarketFetchSuccess([_quote('XAU/USD', 1)]));

      // Must not throw (e.g. notifyListeners()-after-dispose) when the
      // in-flight fetch finally resolves after disposal.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });
}

/// A minimal [MarketService] whose [getCatalog] always throws, for the
/// catalog-load-failure regression test above.
class _CatalogThrowingMarketService implements MarketService {
  @override
  MarketDataMode mode = MarketDataMode.offline;

  @override
  DateTime? lastUpdated;

  @override
  Future<List<MarketSymbolInfo>> getCatalog() async => throw const MarketFetchException(MarketFetchFailureKind.offline, 'catalog down');

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async => const MarketFetchEmpty();

  @override
  Future<MarketQuote?> getQuote(String symbol) async => null;

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async => const [];

  @override
  Future<MarketFetchResult> search(String query) async => const MarketFetchEmpty();

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) => const Stream.empty();

  @override
  Stream<List<MarketCandle>> watchCandles(String symbol, Timeframe timeframe) => const Stream.empty();

  @override
  Future<void> reconnect() async {}

  @override
  void pause() {}

  @override
  void resume() {}
}
