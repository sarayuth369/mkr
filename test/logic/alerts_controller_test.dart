import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/features/alerts/application/alerts_controller.dart';
import 'package:mkr/features/alerts/domain/alert.dart';
import 'package:mkr/features/alerts/domain/alert_repository.dart';
import 'package:mkr/features/alerts/domain/notification_service.dart';
import 'package:mkr/features/calendar/data/mock_economic_calendar_service.dart';
import 'package:mkr/features/markets/data/mock_market_service.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

// 2026-09-15 FINAL correction task, point 3 — AlertsController must
// evaluate price/percentage alerts against a real MarketService, never
// MockMarketCatalog, using one deduplicated batch getQuotesFor() call per
// cycle (never N individual calls, never a new provider/WebSocket per
// alert), and must never fabricate a trigger when the market service is
// unavailable.

MarketQuote _quote(String symbol, double price) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.usStock,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

class _FakeAlertRepository implements AlertRepository {
  _FakeAlertRepository(this._alerts);
  List<Alert> _alerts;

  @override
  Future<List<Alert>> getAlerts() async => _alerts;

  @override
  Future<void> saveAlerts(List<Alert> alerts) async {
    _alerts = alerts;
  }
}

class _FakeNotificationService implements NotificationService {
  final List<String> notified = [];

  @override
  Future<void> notify({required String title, required String body}) async {
    notified.add(body);
  }
}

class _FakeMarketService implements MarketService {
  _FakeMarketService({this.quotesResult = const MarketFetchEmpty()});

  MarketFetchResult quotesResult;
  List<String>? lastRequestedSymbols;
  int getQuotesForCallCount = 0;

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async {
    lastRequestedSymbols = symbols;
    getQuotesForCallCount++;
    return quotesResult;
  }

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

void main() {
  group('AlertsController — 2026-09-15 FINAL correction task (point 3)', () {
    test('real-mode price alert fires from a real MarketService quote, never MockMarketCatalog', () async {
      final repo = _FakeAlertRepository([Alert.price(id: '1', symbol: 'AAPL', target: 200, direction: PriceDirection.above)]);
      final notifications = _FakeNotificationService();
      final service = _FakeMarketService(quotesResult: MarketFetchSuccess([_quote('AAPL', 250)]));
      final controller = AlertsController(
        repository: repo,
        notificationService: notifications,
        calendarService: MockEconomicCalendarService(),
        marketService: service,
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();

      expect(service.getQuotesForCallCount, 1);
      expect(service.lastRequestedSymbols, ['AAPL']);
      expect(notifications.notified, isNotEmpty);
      expect(controller.state.dataOrNull!.single.lastTriggeredAt, isNotNull);

      controller.dispose();
    });

    test('duplicate symbols across alerts are deduplicated into one batch call', () async {
      final repo = _FakeAlertRepository([
        Alert.price(id: '1', symbol: 'AAPL', target: 999999, direction: PriceDirection.above), // won't fire
        Alert.percentage(id: '2', symbol: 'AAPL', thresholdPct: 999), // won't fire
      ]);
      final service = _FakeMarketService(quotesResult: MarketFetchSuccess([_quote('AAPL', 250)]));
      final controller = AlertsController(
        repository: repo,
        notificationService: _FakeNotificationService(),
        calendarService: MockEconomicCalendarService(),
        marketService: service,
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();

      expect(service.getQuotesForCallCount, 1); // never N individual calls
      expect(service.lastRequestedSymbols, ['AAPL']); // deduplicated, not ['AAPL', 'AAPL']

      controller.dispose();
    });

    test('market-service failure never fabricates a trigger - alert state and lastTriggeredAt untouched', () async {
      final repo = _FakeAlertRepository([Alert.price(id: '1', symbol: 'AAPL', target: 1, direction: PriceDirection.above)]);
      final notifications = _FakeNotificationService();
      final service = _FakeMarketService(quotesResult: const MarketFetchFailure(MarketFetchFailureKind.offline, 'down'));
      final controller = AlertsController(
        repository: repo,
        notificationService: notifications,
        calendarService: MockEconomicCalendarService(),
        marketService: service,
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();

      expect(notifications.notified, isEmpty);
      expect(controller.state.dataOrNull!.single.lastTriggeredAt, isNull); // preserved, not fabricated

      controller.dispose();
    });

    test('partial symbol availability: only the resolved symbol can fire, the unresolved one does not', () async {
      final repo = _FakeAlertRepository([
        Alert.price(id: '1', symbol: 'AAPL', target: 200, direction: PriceDirection.above), // resolves, fires
        Alert.price(id: '2', symbol: 'DISABLEDSYM', target: 1, direction: PriceDirection.above), // never resolves
      ]);
      final notifications = _FakeNotificationService();
      final service = _FakeMarketService(quotesResult: MarketFetchPartial([_quote('AAPL', 250)], ['DISABLEDSYM']));
      final controller = AlertsController(
        repository: repo,
        notificationService: notifications,
        calendarService: MockEconomicCalendarService(),
        marketService: service,
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();

      expect(service.lastRequestedSymbols, containsAll(['AAPL', 'DISABLEDSYM']));
      final updated = controller.state.dataOrNull!;
      expect(updated.firstWhere((a) => a.id == '1').lastTriggeredAt, isNotNull);
      expect(updated.firstWhere((a) => a.id == '2').lastTriggeredAt, isNull);

      controller.dispose();
    });

    test('an event-only alert list never calls the market service - no symbols to authorize', () async {
      final repo = _FakeAlertRepository([Alert.event(id: '1', eventKeyword: 'CPI')]);
      final service = _FakeMarketService();
      final controller = AlertsController(
        repository: repo,
        notificationService: _FakeNotificationService(),
        calendarService: MockEconomicCalendarService(),
        marketService: service,
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();

      expect(service.getQuotesForCallCount, 0);

      controller.dispose();
    });

    test('demo mode (MockMarketService) still evaluates alerts correctly through the same real-quote path', () async {
      // AAPL is seeded in MockMarketCatalog at 231.40 - target 200 above fires.
      final repo = _FakeAlertRepository([Alert.price(id: '1', symbol: 'AAPL', target: 200, direction: PriceDirection.above)]);
      final notifications = _FakeNotificationService();
      final controller = AlertsController(
        repository: repo,
        notificationService: notifications,
        calendarService: MockEconomicCalendarService(),
        marketService: MockMarketService(),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();

      expect(notifications.notified, isNotEmpty);

      controller.dispose();
    });

    test('cooldown/dedupe semantics preserved - does not re-notify within 5 minutes', () async {
      final repo = _FakeAlertRepository([Alert.price(id: '1', symbol: 'AAPL', target: 200, direction: PriceDirection.above)]);
      final notifications = _FakeNotificationService();
      final service = _FakeMarketService(quotesResult: MarketFetchSuccess([_quote('AAPL', 250)]));
      final controller = AlertsController(
        repository: repo,
        notificationService: notifications,
        calendarService: MockEconomicCalendarService(),
        marketService: service,
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      await controller.evaluateNow();
      expect(notifications.notified, hasLength(1));

      await controller.evaluateNow();
      expect(notifications.notified, hasLength(1)); // still just one - cooldown honored

      controller.dispose();
    });
  });
}
