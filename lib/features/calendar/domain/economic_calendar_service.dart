import 'economic_event.dart';

abstract class EconomicCalendarService {
  Future<List<EconomicEvent>> getEvents();
}
