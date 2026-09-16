import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/impact_level.dart';
import '../domain/economic_calendar_service.dart';
import '../domain/economic_event.dart';

class CalendarController extends ChangeNotifier {
  CalendarController(this._service) {
    refresh();
  }

  final EconomicCalendarService _service;

  bool get isMock => _service.isMock;

  ApiState<List<EconomicEvent>> _state = const ApiState.loading();
  ApiState<List<EconomicEvent>> get state => _state;

  CalendarFreshness _freshness = CalendarFreshness.offline;
  CalendarFreshness get freshness => _freshness;

  DateTime? _lastUpdatedAt;
  DateTime? get lastUpdatedAt => _lastUpdatedAt;

  CalendarRange _range = CalendarRange.today;
  CalendarRange get range => _range;

  ImpactLevel? _impactFilter;
  ImpactLevel? get impactFilter => _impactFilter;

  String? _countryFilter;
  String? get countryFilter => _countryFilter;

  /// 2026-09-16 Closed Testing readiness task (root cause): keyed by the
  /// exact country CODE the real backend actually returns in
  /// [EconomicEvent.country] (curated_provider.ts only ever sources US/EU/
  /// UK/JP - Fed/BLS/BEA, ECB, BoE, BoJ - see that file's own header
  /// comment), not a display word. The filter previously listed 'Japan'
  /// (never matches the real 'JP' code - always empty against real data)
  /// plus 'China'/'Thailand' (no data source for either exists AT ALL, real
  /// or planned) - selecting either silently showed "no events" forever,
  /// which reads as "nothing scheduled" rather than the honest "MKR doesn't
  /// cover this market yet". The filter must never offer a selection the
  /// real data pipeline can never satisfy.
  static const countries = {'US': 'US', 'EU': 'EU', 'UK': 'UK', 'JP': 'Japan'};

  /// 2026-09-16 Final Full-System One-Pass audit finding: without this, a
  /// slower, older `refresh()` call (e.g. from rapidly tapping Today then
  /// Week before the first fetch resolves) could land after and overwrite a
  /// newer call's already-applied result - the same request-generation
  /// guard pattern already established in MarketsController._loadRequestId.
  int _refreshRequestId = 0;

  Future<void> refresh() async {
    final requestId = ++_refreshRequestId;
    _state = const ApiState.loading();
    notifyListeners();
    try {
      final result = await _service.getEvents(range: _range);
      if (requestId != _refreshRequestId) return;
      final events = [...result.events]..sort((a, b) => a.dateTime.compareTo(b.dateTime));
      _freshness = result.freshness;
      _lastUpdatedAt = result.lastUpdatedAt;
      _state = events.isEmpty ? const ApiState.empty() : ApiState.success(events);
    } catch (e) {
      if (requestId != _refreshRequestId) return;
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  Future<void> setRange(CalendarRange range) async {
    if (range == _range) return;
    _range = range;
    await refresh();
  }

  void setImpactFilter(ImpactLevel? level) {
    _impactFilter = level;
    notifyListeners();
  }

  void setCountryFilter(String? country) {
    _countryFilter = country;
    notifyListeners();
  }

  List<EconomicEvent> visibleEvents() {
    final all = _state.dataOrNull ?? const [];
    return all.where((e) {
      final matchesImpact = _impactFilter == null || e.impact == _impactFilter;
      final matchesCountry = _countryFilter == null || e.country == _countryFilter;
      return matchesImpact && matchesCountry;
    }).toList();
  }
}
