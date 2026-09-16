import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/network/api_state.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_symbol_info.dart';
import 'package:mkr/features/ai/data/mock_market_ai_service.dart';
import 'package:mkr/features/calendar/data/mock_economic_calendar_service.dart';
import 'package:mkr/features/markets/application/market_detail_controller.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:mkr/features/news/data/mock_news_service.dart';

// 2026-09-15 FINAL correction task, point 4 — a genuine catalog/provider
// failure on getPriceSeries must not be indistinguishable from a valid,
// honestly empty history: MarketDetailController.seriesUnavailable must be
// true only for the former, never for "this symbol just has no history".

MarketQuote _quote(String symbol, double price) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.usStock,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

class _FakeMarketService implements MarketService {
  _FakeMarketService({this.quote, this.seriesResult = const [], this.seriesError, this.watchQuotesStream, this.getPriceSeriesImpl, this.getQuoteImpl});

  MarketQuote? quote;
  List<double> seriesResult;
  Object? seriesError;

  /// Overrides [getQuote] entirely when set - lets a test control exactly
  /// when the initial `_load()` call resolves (e.g. via a `Completer`) to
  /// simulate a slow response arriving after the controller is disposed.
  Future<MarketQuote?> Function(String symbol)? getQuoteImpl;

  /// Overrides [watchQuotes]'s returned stream when set - lets a test
  /// control exactly when/what the live subscription emits (or errors).
  Stream<List<MarketQuote>>? watchQuotesStream;

  /// Overrides [getPriceSeries] entirely when set - lets a test control
  /// exactly when each individual call resolves (e.g. via per-timeframe
  /// `Completer`s) to simulate out-of-order responses.
  Future<List<double>> Function(String symbol, ChartTimeframe timeframe)? getPriceSeriesImpl;

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  @override
  Future<List<MarketSymbolInfo>> getCatalog() async => const [];

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async => const MarketFetchEmpty();

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    final impl = getQuoteImpl;
    if (impl != null) return impl(symbol);
    return quote;
  }

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async {
    final impl = getPriceSeriesImpl;
    if (impl != null) return impl(symbol, timeframe);
    final error = seriesError;
    if (error != null) throw error;
    return seriesResult;
  }

  @override
  Future<MarketFetchResult> search(String query) async => const MarketFetchEmpty();

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) => watchQuotesStream ?? const Stream.empty();

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
  group('MarketDetailController — 2026-09-15 FINAL correction task (point 4)', () {
    test('a genuine empty series (no history for this symbol) is not treated as unavailable', () async {
      final service = _FakeMarketService(quote: _quote('AAPL', 100), seriesResult: const []);
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.series, isEmpty);
      expect(controller.seriesUnavailable, isFalse);
    });

    test('a genuine catalog/provider failure sets seriesUnavailable, distinct from a valid empty history', () async {
      final service = _FakeMarketService(
        quote: _quote('AAPL', 100),
        seriesError: const MarketFetchException(MarketFetchFailureKind.offline, 'down'),
      );
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.series, isEmpty);
      expect(controller.seriesUnavailable, isTrue);
    });

    test('a real series is used and seriesUnavailable clears on a successful retry', () async {
      final service = _FakeMarketService(
        quote: _quote('AAPL', 100),
        seriesError: const MarketFetchException(MarketFetchFailureKind.offline, 'down'),
      );
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(controller.seriesUnavailable, isTrue);

      service.seriesError = null;
      service.seriesResult = [1, 2, 3];
      await controller.loadSeries(controller.timeframe);

      expect(controller.series, [1, 2, 3]);
      expect(controller.seriesUnavailable, isFalse);
    });
  });

  group('MarketDetailController — 2026-09-15 pre-Closed-Testing audit', () {
    test('a live-stream error surfaces as ApiState.error, never a silently stale/live-looking quote - Known Issue B', () async {
      final liveController = StreamController<List<MarketQuote>>();
      final service = _FakeMarketService(quote: _quote('AAPL', 100), watchQuotesStream: liveController.stream);
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      // Initial REST load succeeded - quote is showing.
      expect(controller.quoteState, isA<ApiSuccess<MarketQuote>>());

      // The live subscription then genuinely fails (e.g. a catalog
      // re-check inside watchQuotes failing) - previously this had no
      // onError handler at all, so the quote would stay looking "live"
      // forever with no indication the subscription actually died.
      liveController.addError(Exception('live stream broke'));
      await Future<void>.delayed(Duration.zero);

      expect(controller.quoteState, isA<ApiError<MarketQuote>>());

      await liveController.close();
    });

    test('a late (slower) loadSeries response never overwrites a newer (faster) one - Known Issue C', () async {
      final w1Completer = Completer<List<double>>();
      final m1Completer = Completer<List<double>>();
      final service = _FakeMarketService(
        quote: _quote('AAPL', 100),
        getPriceSeriesImpl: (symbol, timeframe) {
          if (timeframe == ChartTimeframe.d1) return Future.value(const [1.0]); // initial _load() call
          return (timeframe == ChartTimeframe.w1 ? w1Completer : m1Completer).future;
        },
      );
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      // Rapidly switch timeframe twice before either resolves - simulates
      // tapping "1W" then "1M" before the first fetch comes back.
      final w1Future = controller.loadSeries(ChartTimeframe.w1);
      final m1Future = controller.loadSeries(ChartTimeframe.m1);

      // The newer request (1M) resolves first.
      m1Completer.complete([9.0, 9.5]);
      await m1Future;
      expect(controller.timeframe, ChartTimeframe.m1);
      expect(controller.series, [9.0, 9.5]);

      // The older, now-stale request (1W) resolves LATE, after 1M already
      // applied - it must be discarded, not overwrite the newer state.
      w1Completer.complete([1.0, 2.0]);
      await w1Future;

      expect(controller.timeframe, ChartTimeframe.m1);
      expect(controller.series, [9.0, 9.5]);
    });
  });

  group('MarketDetailController — 2026-09-16 Final Full-System One-Pass audit: disposal safety', () {
    test('dispose() before the initial getQuote resolves never throws when the pending future later completes', () async {
      final quoteCompleter = Completer<MarketQuote?>();
      final service = _FakeMarketService(getQuoteImpl: (_) => quoteCompleter.future);
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );

      // Back out of the detail screen (dispose) while the initial quote
      // fetch is still in flight - previously this had no `_disposed`
      // guard, so completing the pending future afterwards would call
      // `notifyListeners()` on an already-disposed ChangeNotifier.
      controller.dispose();

      quoteCompleter.complete(_quote('AAPL', 100));
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      // Reaching here without a thrown FlutterError/assertion is the test.
    });

    test('dispose() before loadSeries resolves never throws when the pending future later completes', () async {
      final seriesCompleter = Completer<List<double>>();
      final service = _FakeMarketService(
        quote: _quote('AAPL', 100),
        getPriceSeriesImpl: (symbol, timeframe) => seriesCompleter.future,
      );
      final controller = MarketDetailController(
        symbol: 'AAPL',
        marketService: service,
        aiService: MockMarketAIService(),
        newsService: MockNewsService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero); // let the initial quote fetch resolve, series fetch is now pending

      controller.dispose();

      seriesCompleter.complete([1, 2, 3]);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });
}
