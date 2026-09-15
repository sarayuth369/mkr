import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../domain/impact_level.dart';
import '../domain/economic_calendar_service.dart';
import '../domain/economic_event.dart';

/// Real [EconomicCalendarService] backed by the MKR Cloudflare Worker's
/// provider-neutral Economic Calendar API
/// (`/api/mkr/calendar/events|today|week` - see
/// backend/src/calendar/calendar-routes.ts). Never calls BLS/Fed/ECB/FMP/
/// etc. directly and never holds a provider key - same backend-gateway
/// pattern as [FinnhubNewsService]/the old Finnhub-backed calendar service
/// it replaces (2026-09-15 hybrid-architecture task).
///
/// Throws when the backend reports `economicCalendarEnabled` is off or the
/// call otherwise fails - [CalendarController.refresh] already wraps the
/// call in try/catch and surfaces an error state.
class MkrEconomicCalendarService implements EconomicCalendarService {
  MkrEconomicCalendarService({required this.backendBaseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String backendBaseUrl;
  final http.Client _http;

  @override
  bool get isMock => false;

  Uri _uri(String path) => Uri.parse('$backendBaseUrl$path');

  ImpactLevel _impactFrom(String? value) => switch (value) {
        'high' => ImpactLevel.high,
        'medium' => ImpactLevel.medium,
        'low' => ImpactLevel.low,
        // 'unknown' (or any unrecognized value) never guesses upward -
        // matches the same "never fabricate" discipline the backend
        // itself already applies (classification.ts's DEFAULT_CLASSIFICATION).
        _ => ImpactLevel.low,
      };

  EconomicEventStatus _statusFrom(String? value) => switch (value) {
        'scheduled' => EconomicEventStatus.scheduled,
        'released' => EconomicEventStatus.released,
        'cancelled' => EconomicEventStatus.cancelled,
        _ => EconomicEventStatus.unknown,
      };

  /// Backend numeric+unit fields (`previous: number|null`, `unit:
  /// string|null`) become one display string here - `null` stays `null`
  /// (renders as "—" in [EconomicEventCard]), never a fabricated "0".
  String? _numberWithUnit(dynamic value, String? unit) {
    if (value is! num) return null;
    return unit == null || unit.isEmpty ? '$value' : '$value$unit';
  }

  EconomicEvent _eventFrom(Map<String, dynamic> json) {
    final unit = json['unit'] as String?;
    return EconomicEvent(
      id: json['id'] as String? ?? '',
      dateTime: DateTime.fromMillisecondsSinceEpoch((json['eventTimeUtc'] as num?)?.toInt() ?? 0, isUtc: true).toLocal(),
      country: json['country'] as String? ?? '',
      currency: json['currency'] as String?,
      title: json['title'] as String? ?? '',
      category: json['category'] as String?,
      impact: _impactFrom(json['importance'] as String?),
      previous: _numberWithUnit(json['previous'], unit),
      forecast: _numberWithUnit(json['consensus'], unit),
      actual: _numberWithUnit(json['actual'], unit),
      status: _statusFrom(json['status'] as String?),
      relatedAssets: (json['relatedAssets'] as List?)?.whereType<String>().toList() ?? const [],
      sourceUrl: json['sourceUrl'] as String?,
    );
  }

  CalendarFreshness _freshnessFrom(String? value) => switch (value) {
        'live' => CalendarFreshness.live,
        'stale' => CalendarFreshness.stale,
        'degraded' => CalendarFreshness.degraded,
        _ => CalendarFreshness.offline,
      };

  String _pathFor(CalendarRange? range) => switch (range) {
        CalendarRange.today => '/api/mkr/calendar/today',
        CalendarRange.week || null => '/api/mkr/calendar/week',
        // No dedicated /tomorrow route on the backend (only
        // events/today/week - task spec) - the generic filtered /events
        // route with an explicit date covers it (task: "Support sensible
        // filters: date, from, to, ...").
        CalendarRange.tomorrow => '/api/mkr/calendar/events?date=${_tomorrowDate()}',
      };

  String _tomorrowDate() {
    final tomorrow = DateTime.now().toUtc().add(const Duration(days: 1));
    return '${tomorrow.year.toString().padLeft(4, '0')}-${tomorrow.month.toString().padLeft(2, '0')}-${tomorrow.day.toString().padLeft(2, '0')}';
  }

  @override
  Future<CalendarQueryResult> getEvents({CalendarRange? range}) async {
    final http.Response response;
    try {
      response = await _http.get(_uri(_pathFor(range)));
    } catch (_) {
      throw Exception('Could not reach the calendar service. Check your connection and try again.');
    }

    final dynamic decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic> || decoded['success'] != true) {
      final error = decoded is Map ? decoded['error'] : null;
      final message = error is Map && error['message'] is String ? error['message'] as String : 'The calendar service is currently unavailable.';
      throw Exception(message);
    }

    final data = decoded['data'];
    if (data is! Map<String, dynamic>) return const CalendarQueryResult(events: [], freshness: CalendarFreshness.offline);

    final items = data['items'];
    final events = items is List ? items.whereType<Map<String, dynamic>>().map(_eventFrom).toList() : <EconomicEvent>[];

    final meta = data['meta'];
    final freshness = meta is Map<String, dynamic> ? _freshnessFrom(meta['freshness'] as String?) : CalendarFreshness.offline;
    final lastUpdatedMs = meta is Map<String, dynamic> ? meta['lastUpdatedAt'] as num? : null;

    return CalendarQueryResult(
      events: events,
      freshness: freshness,
      lastUpdatedAt: lastUpdatedMs == null ? null : DateTime.fromMillisecondsSinceEpoch(lastUpdatedMs.toInt(), isUtc: true).toLocal(),
    );
  }
}
