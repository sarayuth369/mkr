import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/market_quote.dart';
import '../../calendar/domain/economic_calendar_service.dart';
import '../../markets/domain/market_fetch_result.dart';
import '../../markets/domain/market_service.dart';
import '../domain/alert.dart';
import '../domain/alert_cloud_sync.dart';
import '../domain/alert_evaluator.dart';
import '../domain/alert_repository.dart';
import '../domain/notification_service.dart';

class AlertsController extends ChangeNotifier {
  AlertsController({
    required AlertRepository repository,
    required NotificationService notificationService,
    required EconomicCalendarService calendarService,
    required MarketService marketService,
    AlertCloudSync cloudSync = const NoopAlertCloudSync(),
  })  : _repository = repository,
        _notificationService = notificationService,
        _calendarService = calendarService,
        _marketService = marketService,
        _cloudSync = cloudSync {
    _load();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _evaluate());
  }

  final AlertRepository _repository;
  final NotificationService _notificationService;
  final EconomicCalendarService _calendarService;
  final MarketService _marketService;
  final AlertCloudSync _cloudSync;
  Timer? _timer;

  ApiState<List<Alert>> _state = const ApiState.loading();
  ApiState<List<Alert>> get state => _state;

  List<Alert> get _alerts => _state.dataOrNull ?? const [];

  Future<void> _load() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      final alerts = await _repository.getAlerts();
      _state = alerts.isEmpty ? const ApiState.empty() : ApiState.success(alerts);
    } catch (e) {
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  Future<void> refresh() => _load();

  Future<void> addAlert(Alert alert) async {
    final updated = [..._alerts, alert];
    await _persist(updated);
  }

  Future<void> toggle(String id, bool enabled) async {
    final updated = _alerts.map((a) => a.id == id ? a.copyWith(isEnabled: enabled) : a).toList();
    await _persist(updated);
  }

  Future<void> delete(String id) async {
    final updated = _alerts.where((a) => a.id != id).toList();
    await _persist(updated);
  }

  Future<void> _persist(List<Alert> alerts) async {
    await _repository.saveAlerts(alerts);
    _state = alerts.isEmpty ? const ApiState.empty() : ApiState.success(alerts);
    notifyListeners();
    // Best-effort, never awaited by the UI — a sync failure must not block
    // the local alert list, which is already saved and displayed above.
    unawaited(_cloudSync.syncPriceAlerts(alerts));
  }

  /// 2026-09-15 FINAL correction task (point 3): price/percentage alerts
  /// now evaluate against real [MarketService] quotes — never
  /// `MockMarketCatalog`. One deduplicated batch [MarketService.getQuotesFor]
  /// call covers every unique symbol the currently active price/percentage
  /// alerts need, reusing the existing catalog-authorized/single-flight
  /// path — never N individual provider calls, never a new
  /// provider/WebSocket per alert. Event alerts need no market data, so a
  /// cycle with only event alerts never calls the market service at all;
  /// `getQuotesFor` itself already never contacts the provider when none of
  /// the requested symbols are enabled in the backend catalog.
  ///
  /// A market-service outage never fabricates a trigger: `getQuotesFor`
  /// never throws (a real fault becomes an empty/failed typed result, not
  /// an exception), so `quotes` simply stays empty and
  /// [AlertEvaluator]'s price/percentage checks already treat a missing
  /// quote as "does not fire" — the alert list is left completely untouched
  /// this cycle (no [_persist] call), preserving the last known state
  /// exactly. The failure is still surfaced via [debugPrint] (matching this
  /// codebase's existing lightweight logging convention, see
  /// `MockNotificationService`) rather than disappearing silently.
  /// Test-only seam: runs one evaluation cycle immediately instead of
  /// waiting for the 30-second [Timer] - production code never calls this.
  @visibleForTesting
  Future<void> evaluateNow() => _evaluate();

  Future<void> _evaluate() async {
    if (_alerts.isEmpty) return;

    final priceSymbols = {
      for (final a in _alerts)
        if (a.isEnabled && (a.type == AlertType.price || a.type == AlertType.percentage)) a.symbol,
    }.toList();

    var quotes = const <String, MarketQuote>{};
    if (priceSymbols.isNotEmpty) {
      final quotesResult = await _marketService.getQuotesFor(priceSymbols);
      if (quotesResult is MarketFetchFailure) {
        debugPrint('[MKR alerts] market data unavailable this cycle (${quotesResult.message}) - preserving last known alert state');
      }
      quotes = {for (final q in quotesResult.quotes) q.symbol: q};
    }

    List<String> eventTitles = const [];
    try {
      final result = await _calendarService.getEvents();
      final today = DateTime.now();
      eventTitles = result.events
          .where((e) =>
              e.dateTime.year == today.year &&
              e.dateTime.month == today.month &&
              e.dateTime.day == today.day)
          .map((e) => e.title)
          .toList();
    } catch (_) {
      eventTitles = const [];
    }

    final triggeredIds = AlertEvaluator.evaluate(
      alerts: _alerts,
      quotes: quotes,
      todaysEventTitles: eventTitles,
    );

    if (triggeredIds.isEmpty) return;

    final now = DateTime.now();
    final updated = <Alert>[];
    for (final alert in _alerts) {
      if (triggeredIds.contains(alert.id) &&
          (alert.lastTriggeredAt == null || now.difference(alert.lastTriggeredAt!).inMinutes > 5)) {
        await _notificationService.notify(
          title: 'MKR Alert',
          body: alert.summary,
        );
        updated.add(alert.copyWith(lastTriggeredAt: now));
      } else {
        updated.add(alert);
      }
    }
    await _persist(updated);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
