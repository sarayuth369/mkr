import 'economic_event.dart';

abstract class EconomicCalendarService {
  /// Whether this implementation serves mock/demo content — screens use
  /// this to decide whether to show the "demo data" banner, matching the
  /// same pattern [MarketService.mode] already uses for market data.
  bool get isMock;

  Future<List<EconomicEvent>> getEvents();
}
