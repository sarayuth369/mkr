import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_symbol_info.dart';
import 'package:mkr/features/ai/data/mock_market_ai_service.dart';
import 'package:mkr/features/calendar/data/mock_economic_calendar_service.dart';
import 'package:mkr/features/gold/application/gold_radar_controller.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

// 2026-09-15 correction task 2 — Gold Radar must obey the same catalog rule
// as every other real-mode path (its `getQuote('DXY')`/`getQuote('US10Y')`/
// `getQuote('OIL')` calls) and must never fabricate a chart from
// MockMarketCatalog — it either uses a genuine fetched series or omits the
// chart entirely (regression 7 + Defect D).

MarketQuote _quote(String symbol, double price) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.gold,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

class _FakeMarketService implements MarketService {
  _FakeMarketService({this.quotesBySymbol = const {}, this.seriesBySymbol = const {}});

  final Map<String, MarketQuote?> quotesBySymbol;
  final Map<String, List<double>> seriesBySymbol;

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
  Future<MarketQuote?> getQuote(String symbol) async => quotesBySymbol[symbol];

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async => seriesBySymbol[symbol] ?? const [];

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
  group('GoldRadarController — 2026-09-15 correction task 2', () {
    test('DXY/US10Y/OIL disabled (null from catalog-authorized getQuote) still yields a successful, honest state preserving valid gold data - regression 7', () async {
      final service = _FakeMarketService(
        quotesBySymbol: {'XAU/USD': _quote('XAU/USD', 2000)}, // DXY/US10Y/OIL absent -> null, matching a disabled catalog symbol
      );
      final controller = GoldRadarController(
        marketService: service,
        aiService: MockMarketAIService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final data = controller.state.dataOrNull;
      expect(data, isNotNull);
      expect(data!.gold.symbol, 'XAU/USD');
      expect(data.dxy, isNull); // honestly unavailable, never fabricated
      expect(data.us10y, isNull);
      expect(data.oil, isNull);
    });

    test('gold itself unavailable (null) is represented as empty, never a crash or fabricated data', () async {
      final service = _FakeMarketService(quotesBySymbol: const {});
      final controller = GoldRadarController(
        marketService: service,
        aiService: MockMarketAIService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state.dataOrNull, isNull);
    });

    test('a genuine fetched series is used for the chart, never MockMarketCatalog.syntheticSeries - Defect D', () async {
      final service = _FakeMarketService(
        quotesBySymbol: {'XAU/USD': _quote('XAU/USD', 2000)},
        seriesBySymbol: {
          'XAU/USD': [1990, 1995, 2000],
        },
      );
      final controller = GoldRadarController(
        marketService: service,
        aiService: MockMarketAIService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.series, [1990, 1995, 2000]);
    });

    test('no real series available - chart series is honestly empty (screen omits the chart) rather than synthetic - Defect D', () async {
      final service = _FakeMarketService(quotesBySymbol: {'XAU/USD': _quote('XAU/USD', 2000)}); // no series stubbed -> []
      final controller = GoldRadarController(
        marketService: service,
        aiService: MockMarketAIService(),
        calendarService: MockEconomicCalendarService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.series, isEmpty);
    });
  });

  group('GoldRadarController — 2026-09-16 Final Full-System One-Pass audit: stale-response race guard', () {
    test('an older, slower retry() call never overwrites a newer one\'s already-applied result', () async {
      final delayedService = _DelayedMarketService(
        firstCallGold: const Duration(milliseconds: 50),
        laterCallGold: Duration.zero,
      );
      final controller = GoldRadarController(
        marketService: delayedService,
        aiService: MockMarketAIService(),
        calendarService: MockEconomicCalendarService(),
      );
      // Constructor already started the FIRST (slow) load. Immediately fire
      // a second, faster retry() before the first resolves - the classic
      // "older response lands after the newer one" race.
      unawaited(controller.retry());
      await Future<void>.delayed(const Duration(milliseconds: 100));

      final data = controller.state.dataOrNull;
      expect(data, isNotNull);
      expect(data!.gold.price, 2222); // the newer (second) call's result - never clobbered by the slower first call landing late
    });
  });
}

class _DelayedMarketService implements MarketService {
  _DelayedMarketService({required this.firstCallGold, required this.laterCallGold});

  final Duration firstCallGold;
  final Duration laterCallGold;
  int _goldCalls = 0;

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
    if (symbol != 'XAU/USD') return null;
    _goldCalls++;
    final isFirstCall = _goldCalls == 1;
    await Future<void>.delayed(isFirstCall ? firstCallGold : laterCallGold);
    return _quote('XAU/USD', isFirstCall ? 1111 : 2222);
  }

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
