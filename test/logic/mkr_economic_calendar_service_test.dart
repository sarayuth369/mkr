import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/domain/impact_level.dart';
import 'package:mkr/features/calendar/data/mkr_economic_calendar_service.dart';
import 'package:mkr/features/calendar/domain/economic_calendar_service.dart';
import 'package:mkr/features/calendar/domain/economic_event.dart';

http.Response _jsonResponse(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

const _event = {
  'id': 'curated_official:cpi-2026-01',
  'source': 'curated_official',
  'sourceEventId': 'cpi-2026-01',
  'eventTimeUtc': 1768505400000,
  'eventTimeLocal': '2026-01-15T14:30:00',
  'country': 'US',
  'currency': 'USD',
  'title': 'US Consumer Price Index (CPI)',
  'category': 'inflation',
  'importance': 'high',
  'previous': 3.1,
  'consensus': 2.9,
  'actual': null,
  'unit': '%',
  'status': 'scheduled',
  'relatedAssets': ['XAU/USD', 'SPX'],
  'sourceUrl': 'https://www.bls.gov/schedule/news_release/current_year.asp',
  'updatedAt': 1757894400000,
};

Map<String, dynamic> _envelope(List<Map<String, dynamic>> items, {String freshness = 'live', int? lastUpdatedAt = 1757894400000}) {
  return {
    'success': true,
    'data': {
      'items': items,
      'meta': {
        'freshness': freshness,
        'lastUpdatedAt': lastUpdatedAt,
        'sources': [],
      },
    },
  };
}

void main() {
  group('MkrEconomicCalendarService', () {
    test('isMock is false - never confused with the demo service', () {
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com');
      expect(service.isMock, isFalse);
    });

    // 2026-09-16 Closed Testing readiness task (root cause): Today/Tomorrow/
    // Week must bucket by the DEVICE's local calendar day/week, never a UTC
    // day the old /today, /week, and /events?date= calls silently assumed -
    // see mkr_economic_calendar_service.dart's _instantRangeQuery doc
    // comment. `DateTime.now()` isn't injectable here, so these assert the
    // STRUCTURE of the resulting instant range (exact duration, local-
    // midnight alignment) rather than a fixed clock value.
    DateTime parseInstantParam(Uri uri, String name) => DateTime.parse(uri.queryParameters[name]!);

    test('getEvents() with no range calls /events with a fromInstant/toInstant spanning the device-local Mon-Sun week', () async {
      Uri? calledUri;
      final client = MockClient((request) async {
        calledUri = request.url;
        return _jsonResponse(_envelope([_event]));
      });
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await service.getEvents();

      expect(calledUri!.path, '/api/mkr/calendar/events');
      final from = parseInstantParam(calledUri!, 'fromInstant').toLocal();
      final to = parseInstantParam(calledUri!, 'toInstant').toLocal();
      expect(from.weekday, DateTime.monday);
      expect(from.hour, 0);
      expect(from.minute, 0);
      expect(to.difference(from), const Duration(days: 7));
    });

    test('CalendarRange.today calls /events with a fromInstant/toInstant spanning exactly the device-local today', () async {
      Uri? calledUri;
      final client = MockClient((request) async {
        calledUri = request.url;
        return _jsonResponse(_envelope([]));
      });
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await service.getEvents(range: CalendarRange.today);

      expect(calledUri!.path, '/api/mkr/calendar/events');
      final from = parseInstantParam(calledUri!, 'fromInstant').toLocal();
      final to = parseInstantParam(calledUri!, 'toInstant').toLocal();
      final now = DateTime.now();
      expect(from.year, now.year);
      expect(from.month, now.month);
      expect(from.day, now.day);
      expect(from.hour, 0);
      expect(from.minute, 0);
      expect(to.difference(from), const Duration(days: 1));
    });

    test('CalendarRange.tomorrow calls /events with a fromInstant/toInstant spanning exactly the device-local tomorrow', () async {
      Uri? calledUri;
      final client = MockClient((request) async {
        calledUri = request.url;
        return _jsonResponse(_envelope([]));
      });
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await service.getEvents(range: CalendarRange.tomorrow);

      expect(calledUri!.path, '/api/mkr/calendar/events');
      final from = parseInstantParam(calledUri!, 'fromInstant').toLocal();
      final to = parseInstantParam(calledUri!, 'toInstant').toLocal();
      final expectedTomorrow = DateTime.now().add(const Duration(days: 1));
      expect(from.year, expectedTomorrow.year);
      expect(from.month, expectedTomorrow.month);
      expect(from.day, expectedTomorrow.day);
      expect(from.hour, 0);
      expect(from.minute, 0);
      expect(to.difference(from), const Duration(days: 1));
    });

    test('maps a well-formed item to EconomicEvent, including numeric+unit -> display-string previous/forecast', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([_event])));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events, hasLength(1));
      final event = result.events.single;
      expect(event.title, 'US Consumer Price Index (CPI)');
      expect(event.country, 'US');
      expect(event.currency, 'USD');
      expect(event.category, 'inflation');
      expect(event.impact, ImpactLevel.high);
      expect(event.previous, '3.1%');
      expect(event.forecast, '2.9%');
      expect(event.actual, isNull); // never fabricated
      expect(event.status, EconomicEventStatus.scheduled);
      expect(event.relatedAssets, ['XAU/USD', 'SPX']);
      expect(event.sourceUrl, isNotNull);
    });

    test('a null actual/previous/consensus stays null, never a fabricated "0<unit>"', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([
            {..._event, 'previous': null, 'consensus': null, 'actual': null},
          ])));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events.single.previous, isNull);
      expect(result.events.single.forecast, isNull);
      expect(result.events.single.actual, isNull);
    });

    test('a zero actual formats as a real "0<unit>", not null - zero is a real value', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([
            {..._event, 'actual': 0},
          ])));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events.single.actual, '0%');
    });

    test('maps unrecognized/missing importance to low, never fabricating high', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([
            {..._event, 'importance': 'unknown'},
          ])));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events.single.impact, ImpactLevel.low);
    });

    test('maps every status value correctly, including cancelled', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([
            {..._event, 'status': 'cancelled'},
          ])));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events.single.status, EconomicEventStatus.cancelled);
    });

    test('maps freshness/lastUpdatedAt from the response meta - never claims live without it', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([], freshness: 'stale')));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.freshness, CalendarFreshness.stale);
      expect(result.lastUpdatedAt, isNotNull);
    });

    test('an empty calendar (no items) returns an empty list, not an error', () async {
      final client = MockClient((request) async => _jsonResponse(_envelope([])));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events, isEmpty);
    });

    test('throws carrying the backend\'s own message when the feature flag is off', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': false,
          'error': {'code': 'FEATURE_DISABLED', 'message': 'The economic calendar is not enabled on this deployment.'},
        }, status: 503);
      });
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(
        service.getEvents(),
        throwsA(predicate((e) => e.toString().contains('The economic calendar is not enabled on this deployment.'))),
      );
    });

    test('throws a clean exception (not a raw one) when the HTTP call itself fails', () async {
      final client = MockClient((request) async => throw Exception('socket closed'));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(service.getEvents(), throwsException);
    });

    test('returns an offline/empty result rather than throwing when data is missing/malformed', () async {
      final client = MockClient((request) async => _jsonResponse({'success': true, 'data': 'not-a-map'}));
      final service = MkrEconomicCalendarService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final result = await service.getEvents();

      expect(result.events, isEmpty);
      expect(result.freshness, CalendarFreshness.offline);
    });
  });
}
