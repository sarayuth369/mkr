import 'economic_event.dart';

/// Matches the backend's centralized freshness policy
/// (backend/src/calendar/freshness.ts) - never treat cached/served data as
/// LIVE merely because it exists.
enum CalendarFreshness { live, stale, degraded, offline }

/// Which window the UI is asking for - Today / Tomorrow / This Week (task
/// requirement). `null` (the default for [EconomicCalendarService.getEvents])
/// means "this week", matching the broadest useful default.
enum CalendarRange { today, tomorrow, week }

class CalendarQueryResult {
  const CalendarQueryResult({required this.events, required this.freshness, this.lastUpdatedAt});

  final List<EconomicEvent> events;
  final CalendarFreshness freshness;
  final DateTime? lastUpdatedAt;
}

abstract class EconomicCalendarService {
  /// Whether this implementation serves mock/demo content — screens use
  /// this to decide whether to show the "demo data" banner, matching the
  /// same pattern [MarketService.mode] already uses for market data.
  bool get isMock;

  Future<CalendarQueryResult> getEvents({CalendarRange? range});
}
