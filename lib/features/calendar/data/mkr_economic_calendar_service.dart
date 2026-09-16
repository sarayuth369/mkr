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

  /// 2026-09-16 Closed Testing readiness task (root cause): Today/Tomorrow/
  /// This Week must bucket by the DEVICE's actual local calendar day/week,
  /// never a UTC calendar day - confirmed live-equivalent (via direct code
  /// reading of the backend's `/today`/`/week` routes, both explicitly
  /// UTC-day-based) that a Bangkok (UTC+7) device between local 00:00-06:59
  /// would see "Today" still showing the PRIOR UTC day - today's own
  /// events look like they're missing. The backend's `/events` route now
  /// accepts `fromInstant`/`toInstant` (exact UTC instants, not a bare
  /// date reinterpreted as a UTC day - see CalendarEventFilters' doc
  /// comment in backend/src/calendar/types.ts) specifically so a client
  /// that knows its own local day boundary can express it exactly. This
  /// replaces the old reliance on `/today`/`/week` (server-computed UTC
  /// day/week, ignores the device entirely) and the old `/events?date=`
  /// call for "tomorrow" (previously also UTC-based via `.toUtc()`).
  String _instantRangeQuery(CalendarRange? range) {
    final now = DateTime.now(); // device-local
    late DateTime localFrom;
    late DateTime localToExclusive;
    switch (range) {
      case CalendarRange.today:
        localFrom = DateTime(now.year, now.month, now.day);
        localToExclusive = localFrom.add(const Duration(days: 1));
      case CalendarRange.tomorrow:
        localFrom = DateTime(now.year, now.month, now.day).add(const Duration(days: 1));
        localToExclusive = localFrom.add(const Duration(days: 1));
      case CalendarRange.week:
      case null:
        // Monday-Sunday, device-local - DateTime.weekday is 1=Mon..7=Sun.
        final monday = DateTime(now.year, now.month, now.day).subtract(Duration(days: now.weekday - 1));
        localFrom = monday;
        localToExclusive = monday.add(const Duration(days: 7));
    }
    final fromInstant = Uri.encodeQueryComponent(localFrom.toUtc().toIso8601String());
    final toInstant = Uri.encodeQueryComponent(localToExclusive.toUtc().toIso8601String());
    return '/api/mkr/calendar/events?fromInstant=$fromInstant&toInstant=$toInstant';
  }

  @override
  Future<CalendarQueryResult> getEvents({CalendarRange? range}) async {
    final http.Response response;
    try {
      response = await _http.get(_uri(_instantRangeQuery(range)));
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
