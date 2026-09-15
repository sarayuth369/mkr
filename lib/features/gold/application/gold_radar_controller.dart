import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/impact_level.dart';
import '../../../domain/market_data_mode.dart';
import '../../ai/domain/ai_insight.dart';
import '../../ai/domain/market_ai_service.dart';
import '../../calendar/domain/economic_calendar_service.dart';
import '../../calendar/domain/economic_event.dart';
import '../../markets/domain/market_service.dart';
import '../domain/gold_radar_data.dart';

class GoldRadarController extends ChangeNotifier {
  GoldRadarController({
    required MarketService marketService,
    required MarketAIService aiService,
    required EconomicCalendarService calendarService,
  })  : _marketService = marketService,
        _aiService = aiService,
        _calendarService = calendarService {
    _load();
  }

  final MarketService _marketService;
  final MarketAIService _aiService;
  final EconomicCalendarService _calendarService;

  MarketDataMode get mode => _marketService.mode;
  DateTime? get lastUpdated => _marketService.lastUpdated;

  ApiState<GoldRadarData> _state = const ApiState.loading();
  ApiState<GoldRadarData> get state => _state;

  ApiState<AIInsight> _aiState = const ApiState.loading();
  ApiState<AIInsight> get aiState => _aiState;

  List<EconomicEvent> _importantEvents = const [];
  List<EconomicEvent> get importantEvents => _importantEvents;

  Future<void> _load() async {
    _state = const ApiState.loading();
    _aiState = const ApiState.loading();
    notifyListeners();

    try {
      final gold = await _marketService.getQuote('XAU/USD');
      if (gold == null) {
        _state = const ApiState.empty();
      } else {
        final dxy = await _marketService.getQuote('DXY');
        final us10y = await _marketService.getQuote('US10Y');
        final oil = await _marketService.getQuote('OIL');
        _state = ApiState.success(
          GoldRadarData.derive(gold: gold, dxy: dxy, us10y: us10y, oil: oil),
        );
      }
    } catch (e) {
      _state = ApiState.error(e.toString());
    }
    notifyListeners();

    try {
      final result = await _calendarService.getEvents();
      _importantEvents = result.events.where((e) => e.impact != ImpactLevel.low).take(4).toList();
    } catch (_) {
      _importantEvents = const [];
    }
    notifyListeners();

    try {
      final insight = await _aiService.getAssetInsight('XAU/USD');
      _aiState = ApiState.success(insight);
    } catch (e) {
      _aiState = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  Future<void> retry() => _load();
}
