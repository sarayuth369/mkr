import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
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
  _FakeMarketService({this.quote, this.seriesResult = const [], this.seriesError});

  MarketQuote? quote;
  List<double> seriesResult;
  Object? seriesError;

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async => const MarketFetchEmpty();

  @override
  Future<MarketQuote?> getQuote(String symbol) async => quote;

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async {
    final error = seriesError;
    if (error != null) throw error;
    return seriesResult;
  }

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
}
