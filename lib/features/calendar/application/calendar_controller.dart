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

  ApiState<List<EconomicEvent>> _state = const ApiState.loading();
  ApiState<List<EconomicEvent>> get state => _state;

  ImpactLevel? _impactFilter;
  ImpactLevel? get impactFilter => _impactFilter;

  String? _countryFilter;
  String? get countryFilter => _countryFilter;

  static const countries = ['US', 'EU', 'UK', 'Japan', 'China', 'Thailand'];

  Future<void> refresh() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      final events = await _service.getEvents()
        ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
      _state = events.isEmpty ? const ApiState.empty() : ApiState.success(events);
    } catch (e) {
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
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
