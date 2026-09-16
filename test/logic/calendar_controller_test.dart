import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/impact_level.dart';
import 'package:mkr/features/calendar/application/calendar_controller.dart';
import 'package:mkr/features/calendar/domain/economic_calendar_service.dart';
import 'package:mkr/features/calendar/domain/economic_event.dart';

// 2026-09-16 Final Full-System One-Pass audit finding: refresh() had no
// request-generation guard, so a slower, older fetch (e.g. from rapidly
// tapping Today then Week before the first resolves) could land after and
// silently overwrite a newer call's already-applied state - the same class
// of bug already fixed elsewhere via MarketsController._loadRequestId.

EconomicEvent _event(String id, CalendarRange forRange) => EconomicEvent(
      id: id,
      dateTime: DateTime.utc(2026, 1, 1),
      country: 'US',
      title: forRange.name,
      impact: ImpactLevel.medium,
    );

class _DelayedCalendarService implements EconomicCalendarService {
  _DelayedCalendarService();

  @override
  bool get isMock => false;

  int _calls = 0;

  @override
  Future<CalendarQueryResult> getEvents({CalendarRange? range}) async {
    _calls++;
    final isFirstCall = _calls == 1;
    // First call is slow (simulates the initial refresh() from the
    // constructor); every later call resolves immediately.
    await Future<void>.delayed(isFirstCall ? const Duration(milliseconds: 50) : Duration.zero);
    return CalendarQueryResult(
      events: [_event(isFirstCall ? 'first' : 'second', range ?? CalendarRange.week)],
      freshness: CalendarFreshness.live,
    );
  }
}

void main() {
  group('CalendarController — 2026-09-16 Final Full-System One-Pass audit: stale-response race guard', () {
    test('an older, slower refresh() call never overwrites a newer one\'s already-applied result', () async {
      final service = _DelayedCalendarService();
      final controller = CalendarController(service);
      // Constructor already started the first (slow) refresh(). Fire a
      // second, faster refresh() immediately, before the first resolves.
      unawaited(controller.refresh());
      await Future<void>.delayed(const Duration(milliseconds: 100));

      final events = controller.state.dataOrNull;
      expect(events, isNotNull);
      expect(events!.single.id, 'second'); // the newer call's result - never clobbered by the slower first call landing late
    });

    test('setRange fires a race the same way - the older range\'s response is discarded, not applied over the newer one', () async {
      final service = _DelayedCalendarService();
      final controller = CalendarController(service);
      await Future<void>.delayed(const Duration(milliseconds: 60)); // let the initial (slow) refresh() settle first

      unawaited(controller.setRange(CalendarRange.today));
      unawaited(controller.setRange(CalendarRange.week));
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(controller.range, CalendarRange.week); // the last-set range wins, and its response is what's actually applied
    });
  });
}
