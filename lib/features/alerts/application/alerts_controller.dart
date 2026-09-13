import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/market_quote.dart';
import '../../calendar/domain/economic_calendar_service.dart';
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
    AlertCloudSync cloudSync = const NoopAlertCloudSync(),
  })  : _repository = repository,
        _notificationService = notificationService,
        _calendarService = calendarService,
        _cloudSync = cloudSync {
    _load();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _evaluate());
  }

  final AlertRepository _repository;
  final NotificationService _notificationService;
  final EconomicCalendarService _calendarService;
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

  Future<void> _evaluate() async {
    if (_alerts.isEmpty) return;
    final quotes = <String, MarketQuote>{
      for (final q in MockMarketCatalog.all) q.symbol: q,
    };
    List<String> eventTitles = const [];
    try {
      final events = await _calendarService.getEvents();
      final today = DateTime.now();
      eventTitles = events
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
