import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../domain/impact_level.dart';
import '../domain/economic_calendar_service.dart';
import '../domain/economic_event.dart';

/// Real [EconomicCalendarService] backed by the MKR Cloudflare Worker's
/// `/api/mkr/calendar/events` route (Finnhub under the hood - see
/// backend/src/news/news-routes.ts). Never calls Finnhub directly and never
/// holds a key - same backend-gateway pattern as [FinnhubNewsService].
///
/// Throws when the backend reports `economicCalendarEnabled` is off or the
/// call otherwise fails - [CalendarController.refresh] already wraps the
/// call in try/catch and surfaces an error state.
class FinnhubEconomicCalendarService implements EconomicCalendarService {
  FinnhubEconomicCalendarService({required this.backendBaseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String backendBaseUrl;
  final http.Client _http;

  @override
  bool get isMock => false;

  Uri _uri(String path) => Uri.parse('$backendBaseUrl$path');

  ImpactLevel _impactFrom(String? value) => switch (value) {
        'high' => ImpactLevel.high,
        'medium' => ImpactLevel.medium,
        _ => ImpactLevel.low,
      };

  EconomicEvent _eventFrom(Map<String, dynamic> json) {
    return EconomicEvent(
      id: json['id'] as String? ?? '',
      dateTime: DateTime.fromMillisecondsSinceEpoch((json['dateTime'] as num?)?.toInt() ?? 0),
      country: json['country'] as String? ?? '',
      title: json['title'] as String? ?? '',
      impact: _impactFrom(json['impact'] as String?),
      previous: json['previous'] as String?,
      forecast: json['forecast'] as String?,
      actual: json['actual'] as String?,
    );
  }

  @override
  Future<List<EconomicEvent>> getEvents() async {
    final http.Response response;
    try {
      response = await _http.get(_uri('/api/mkr/calendar/events'));
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
    if (data is! List) return const [];
    return data.whereType<Map<String, dynamic>>().map(_eventFrom).toList();
  }
}
