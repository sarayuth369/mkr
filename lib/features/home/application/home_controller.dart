import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/impact_level.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/radar_item.dart';
import '../../ai/domain/ai_insight.dart';
import '../../ai/domain/market_ai_service.dart';
import '../../calendar/domain/economic_calendar_service.dart';
import '../../markets/domain/market_service.dart';

class HomeController extends ChangeNotifier {
  HomeController({
    required MarketService marketService,
    required MarketAIService aiService,
    required EconomicCalendarService calendarService,
  })  : _marketService = marketService,
        _aiService = aiService,
        _calendarService = calendarService {
    refresh();
  }

  final MarketService _marketService;
  final MarketAIService _aiService;
  final EconomicCalendarService _calendarService;

  static const statusSymbols = ['SPX', 'XAU/USD', 'BTC', 'NDX', 'SET'];
  static const usMarketSymbols = ['SPX', 'NDX', 'DJI', 'VIX'];
  static const cryptoSymbols = ['BTC', 'ETH', 'SOL', 'XRP'];

  ApiState<List<MarketQuote>> _statusState = const ApiState.loading();
  ApiState<List<MarketQuote>> get statusState => _statusState;

  ApiState<List<MarketQuote>> _usMarketState = const ApiState.loading();
  ApiState<List<MarketQuote>> get usMarketState => _usMarketState;

  ApiState<List<MarketQuote>> _cryptoState = const ApiState.loading();
  ApiState<List<MarketQuote>> get cryptoState => _cryptoState;

  MarketQuote? _gold;
  MarketQuote? get gold => _gold;

  ApiState<List<RadarItem>> _radarState = const ApiState.loading();
  ApiState<List<RadarItem>> get radarState => _radarState;

  ApiState<AIInsight> _briefState = const ApiState.loading();
  ApiState<AIInsight> get briefState => _briefState;

  Future<void> refresh() async {
    _statusState = const ApiState.loading();
    _usMarketState = const ApiState.loading();
    _cryptoState = const ApiState.loading();
    _radarState = const ApiState.loading();
    _briefState = const ApiState.loading();
    notifyListeners();

    try {
      final all = await _marketService.getAllQuotes();
      final bySymbol = {for (final q in all) q.symbol: q};
      _statusState = ApiState.success(
        [for (final s in statusSymbols) bySymbol[s]].whereType<MarketQuote>().toList(),
      );
      _usMarketState = ApiState.success(
        [for (final s in usMarketSymbols) bySymbol[s]].whereType<MarketQuote>().toList(),
      );
      _cryptoState = ApiState.success(
        [for (final s in cryptoSymbols) bySymbol[s]].whereType<MarketQuote>().toList(),
      );
      _gold = bySymbol['XAU/USD'];
    } catch (e) {
      _statusState = ApiState.error(e.toString());
      _usMarketState = ApiState.error(e.toString());
      _cryptoState = ApiState.error(e.toString());
    }
    notifyListeners();

    try {
      final events = await _calendarService.getEvents();
      final today = DateTime.now();
      final todays = events.where((e) =>
          e.dateTime.year == today.year && e.dateTime.month == today.month && e.dateTime.day == today.day);
      final items = todays
          .map((e) => RadarItem(title: e.title, time: e.dateTime, impact: e.impact, subtitle: e.country))
          .toList()
        ..sort((a, b) => a.impact.sortWeight.compareTo(b.impact.sortWeight));
      _radarState = items.isEmpty ? const ApiState.empty() : ApiState.success(items);
    } catch (e) {
      _radarState = ApiState.error(e.toString());
    }
    notifyListeners();

    try {
      final brief = await _aiService.getDailyBrief();
      _briefState = ApiState.success(brief);
    } catch (e) {
      _briefState = ApiState.error(e.toString());
    }
    notifyListeners();
  }
}
