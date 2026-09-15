import '../../../domain/impact_level.dart';
import '../domain/economic_calendar_service.dart';
import '../domain/economic_event.dart';

class MockEconomicCalendarService implements EconomicCalendarService {
  @override
  bool get isMock => true;

  @override
  Future<List<EconomicEvent>> getEvents() async {
    await Future.delayed(const Duration(milliseconds: 300));
    final today = DateTime.now();
    DateTime at(int dayOffset, int hour, int minute) {
      final d = today.add(Duration(days: dayOffset));
      return DateTime(d.year, d.month, d.day, hour, minute);
    }

    return [
      EconomicEvent(
        id: 'e1',
        dateTime: at(0, 19, 30),
        country: 'US',
        title: 'US CPI (YoY)',
        impact: ImpactLevel.high,
        previous: '3.1%',
        forecast: '2.9%',
      ),
      EconomicEvent(
        id: 'e2',
        dateTime: at(0, 21, 0),
        country: 'US',
        title: 'Fed Speech — Chair Press Conference',
        impact: ImpactLevel.high,
        previous: null,
        forecast: null,
      ),
      EconomicEvent(
        id: 'e3',
        dateTime: at(0, 15, 30),
        country: 'EU',
        title: 'ECB Interest Rate Decision',
        impact: ImpactLevel.high,
        previous: '4.25%',
        forecast: '4.00%',
      ),
      EconomicEvent(
        id: 'e4',
        dateTime: at(1, 9, 30),
        country: 'UK',
        title: 'UK GDP (QoQ)',
        impact: ImpactLevel.medium,
        previous: '0.2%',
        forecast: '0.3%',
      ),
      EconomicEvent(
        id: 'e5',
        dateTime: at(1, 7, 50),
        country: 'Japan',
        title: 'BoJ Policy Statement',
        impact: ImpactLevel.medium,
        previous: null,
        forecast: null,
      ),
      EconomicEvent(
        id: 'e6',
        dateTime: at(1, 10, 0),
        country: 'China',
        title: 'China Retail Sales (YoY)',
        impact: ImpactLevel.medium,
        previous: '3.2%',
        forecast: '3.5%',
      ),
      EconomicEvent(
        id: 'e7',
        dateTime: at(2, 20, 30),
        country: 'US',
        title: 'US Non-Farm Payrolls',
        impact: ImpactLevel.high,
        previous: '199K',
        forecast: '180K',
      ),
      EconomicEvent(
        id: 'e8',
        dateTime: at(2, 12, 0),
        country: 'Thailand',
        title: 'Thailand Trade Balance',
        impact: ImpactLevel.low,
        previous: '฿1.2B',
        forecast: '฿1.5B',
      ),
      EconomicEvent(
        id: 'e9',
        dateTime: at(-1, 19, 30),
        country: 'US',
        title: 'US Core PCE (MoM)',
        impact: ImpactLevel.medium,
        previous: '0.2%',
        forecast: '0.2%',
        actual: '0.2%',
      ),
      EconomicEvent(
        id: 'e10',
        dateTime: at(-1, 8, 0),
        country: 'EU',
        title: 'Eurozone Manufacturing PMI',
        impact: ImpactLevel.low,
        previous: '48.5',
        forecast: '48.8',
        actual: '49.1',
      ),
    ];
  }
}
