import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/domain/impact_level.dart';
import 'package:mkr/features/calendar/data/finnhub_economic_calendar_service.dart';

http.Response _jsonResponse(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

const _event = {
  'id': 'US-CPI (YoY)-2026-01-15 19:30:00',
  'dateTime': 1768505400000,
  'country': 'US',
  'title': 'US CPI (YoY)',
  'impact': 'high',
  'previous': '3.1%',
  'forecast': '2.9%',
  'actual': null,
};

void main() {
  group('FinnhubEconomicCalendarService', () {
    test('isMock is false - never confused with the demo service', () {
      final service = FinnhubEconomicCalendarService(backendBaseUrl: 'https://backend.example.com');
      expect(service.isMock, isFalse);
    });

    test('getEvents() calls /api/mkr/calendar/events and maps a successful envelope to EconomicEvent', () async {
      Uri? calledUri;
      final client = MockClient((request) async {
        calledUri = request.url;
        return _jsonResponse({
          'success': true,
          'data': [_event],
        });
      });
      final service = FinnhubEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final events = await service.getEvents();

      expect(calledUri.toString(), 'https://backend.example.com/api/mkr/calendar/events');
      expect(events, hasLength(1));
      expect(events.single.title, 'US CPI (YoY)');
      expect(events.single.country, 'US');
      expect(events.single.impact, ImpactLevel.high);
      expect(events.single.previous, '3.1%');
      expect(events.single.forecast, '2.9%');
      expect(events.single.actual, isNull);
      expect(events.single.dateTime, DateTime.fromMillisecondsSinceEpoch(1768505400000));
    });

    test('maps unrecognized/missing impact to low, never fabricating high', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': true,
          'data': [
            {..._event, 'impact': null},
          ],
        });
      });
      final service = FinnhubEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final events = await service.getEvents();

      expect(events.single.impact, ImpactLevel.low);
    });

    test('throws carrying the backend\'s own message when the feature flag is off', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': false,
          'error': {'code': 'FEATURE_DISABLED', 'message': 'The economic calendar is not enabled on this deployment.'},
        }, status: 503);
      });
      final service = FinnhubEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(
        service.getEvents(),
        throwsA(predicate((e) => e.toString().contains('The economic calendar is not enabled on this deployment.'))),
      );
    });

    test('throws a clean exception (not a raw one) when the HTTP call itself fails', () async {
      final client = MockClient((request) async => throw Exception('socket closed'));
      final service = FinnhubEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(service.getEvents(), throwsException);
    });

    test('returns an empty list rather than throwing when data is missing/malformed', () async {
      final client = MockClient((request) async => _jsonResponse({'success': true, 'data': 'not-a-list'}));
      final service = FinnhubEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      expect(await service.getEvents(), isEmpty);
    });
  });
}
