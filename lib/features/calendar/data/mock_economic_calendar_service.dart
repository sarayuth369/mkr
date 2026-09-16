import '../../../domain/impact_level.dart';
import '../domain/economic_calendar_service.dart';
import '../domain/economic_event.dart';

class MockEconomicCalendarService implements EconomicCalendarService {
  @override
  bool get isMock => true;

  @override
  Future<CalendarQueryResult> getEvents({CalendarRange? range}) async {
    await Future.delayed(const Duration(milliseconds: 300));
    final today = DateTime.now();
    DateTime at(int dayOffset, int hour, int minute) {
      final d = today.add(Duration(days: dayOffset));
      return DateTime(d.year, d.month, d.day, hour, minute);
    }

    final events = [
      EconomicEvent(
        id: 'e1',
        dateTime: at(0, 19, 30),
        country: 'US',
        currency: 'USD',
        category: 'inflation',
        title: 'US CPI (YoY)',
        impact: ImpactLevel.high,
        previous: '3.1%',
        forecast: '2.9%',
        status: EconomicEventStatus.scheduled,
        relatedAssets: const ['XAU/USD', 'SPX'],
      ),
      EconomicEvent(
        id: 'e2',
        dateTime: at(0, 21, 0),
        country: 'US',
        currency: 'USD',
        category: 'monetary_policy',
        title: 'Fed Speech — Chair Press Conference',
        impact: ImpactLevel.high,
        previous: null,
        forecast: null,
        status: EconomicEventStatus.scheduled,
        relatedAssets: const ['XAU/USD'],
      ),
      EconomicEvent(
        id: 'e3',
        dateTime: at(0, 15, 30),
        country: 'EU',
        currency: 'EUR',
        category: 'monetary_policy',
        title: 'ECB Interest Rate Decision',
        impact: ImpactLevel.high,
        previous: '4.25%',
        forecast: '4.00%',
        status: EconomicEventStatus.scheduled,
        relatedAssets: const ['EUR/USD'],
      ),
      EconomicEvent(
        id: 'e4',
        dateTime: at(1, 9, 30),
        country: 'UK',
        currency: 'GBP',
        category: 'growth',
        title: 'UK GDP (QoQ)',
        impact: ImpactLevel.medium,
        previous: '0.2%',
        forecast: '0.3%',
        status: EconomicEventStatus.scheduled,
      ),
      EconomicEvent(
        id: 'e5',
        dateTime: at(1, 7, 50),
        // 2026-09-16 Closed Testing readiness task: the real backend's JP
        // events use the bare code 'JP' (curated_provider.ts), never the
        // display word 'Japan' - matched here so the demo country filter
        // (CalendarController.countries) behaves the same way it does
        // against real data, and so this card's country display matches
        // the bare-code style every other demo event here already uses
        // (US/EU/UK).
        country: 'JP',
        currency: 'JPY',
        category: 'monetary_policy',
        title: 'BoJ Policy Statement',
        impact: ImpactLevel.medium,
        previous: null,
        forecast: null,
        status: EconomicEventStatus.scheduled,
        relatedAssets: const ['USD/JPY'],
      ),
      EconomicEvent(
        id: 'e6',
        dateTime: at(1, 10, 0),
        country: 'China',
        currency: 'CNY',
        category: 'consumer',
        title: 'China Retail Sales (YoY)',
        impact: ImpactLevel.medium,
        previous: '3.2%',
        forecast: '3.5%',
        status: EconomicEventStatus.scheduled,
      ),
      EconomicEvent(
        id: 'e7',
        dateTime: at(2, 20, 30),
        country: 'US',
        currency: 'USD',
        category: 'employment',
        title: 'US Non-Farm Payrolls',
        impact: ImpactLevel.high,
        previous: '199K',
        forecast: '180K',
        status: EconomicEventStatus.scheduled,
        relatedAssets: const ['XAU/USD', 'SPX'],
      ),
      EconomicEvent(
        id: 'e8',
        dateTime: at(2, 12, 0),
        country: 'Thailand',
        currency: 'THB',
        category: 'trade',
        title: 'Thailand Trade Balance',
        impact: ImpactLevel.low,
        previous: '฿1.2B',
        forecast: '฿1.5B',
        status: EconomicEventStatus.scheduled,
      ),
      EconomicEvent(
        id: 'e9',
        dateTime: at(-1, 19, 30),
        country: 'US',
        currency: 'USD',
        category: 'inflation',
        title: 'US Core PCE (MoM)',
        impact: ImpactLevel.medium,
        previous: '0.2%',
        forecast: '0.2%',
        actual: '0.2%',
        status: EconomicEventStatus.released,
      ),
      EconomicEvent(
        id: 'e10',
        dateTime: at(-1, 8, 0),
        country: 'EU',
        currency: 'EUR',
        category: 'manufacturing',
        title: 'Eurozone Manufacturing PMI',
        impact: ImpactLevel.low,
        previous: '48.5',
        forecast: '48.8',
        actual: '49.1',
        status: EconomicEventStatus.released,
      ),
    ];

    final filtered = switch (range) {
      CalendarRange.today => events.where((e) => _isSameDay(e.dateTime, today)).toList(),
      CalendarRange.tomorrow => events.where((e) => _isSameDay(e.dateTime, today.add(const Duration(days: 1)))).toList(),
      CalendarRange.week || null => events,
    };

    return CalendarQueryResult(events: filtered, freshness: CalendarFreshness.live, lastUpdatedAt: DateTime.now());
  }

  bool _isSameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;
}
