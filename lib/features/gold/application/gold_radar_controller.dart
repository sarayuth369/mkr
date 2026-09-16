import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../core/widgets/price_chart.dart';
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

  /// Genuine historical series for the price chart - never
  /// `MockMarketCatalog.syntheticSeries` in real mode. Empty when no real
  /// history is available; the screen omits the chart rather than showing a
  /// fabricated one (2026-09-15 correction task, Defect D).
  List<double> _series = const [];
  List<double> get series => _series;

  /// 2026-09-16 Final Full-System One-Pass audit finding: without this, two
  /// overlapping `_load()` calls (e.g. a double-tap on retry) could let the
  /// slower, older call's response land after and overwrite the newer
  /// call's already-applied result - the same request-generation guard
  /// pattern already established in MarketsController._loadRequestId.
  int _loadRequestId = 0;

  Future<void> _load() async {
    final requestId = ++_loadRequestId;
    _state = const ApiState.loading();
    _aiState = const ApiState.loading();
    notifyListeners();

    try {
      final gold = await _marketService.getQuote('XAU/USD');
      if (requestId != _loadRequestId) return;
      if (gold == null) {
        _state = const ApiState.empty();
        _series = const [];
      } else {
        final dxy = await _marketService.getQuote('DXY');
        if (requestId != _loadRequestId) return;
        final us10y = await _marketService.getQuote('US10Y');
        if (requestId != _loadRequestId) return;
        final oil = await _marketService.getQuote('OIL');
        if (requestId != _loadRequestId) return;
        _state = ApiState.success(
          GoldRadarData.derive(gold: gold, dxy: dxy, us10y: us10y, oil: oil),
        );
        // Fetched separately from the quotes above: a rare series-only
        // failure (e.g. a catalog blip between calls) must not discard the
        // gold/dxy/us10y/oil data that already resolved successfully - the
        // chart simply stays omitted rather than the whole screen erroring.
        try {
          _series = await _marketService.getPriceSeries('XAU/USD', ChartTimeframe.d1);
        } catch (_) {
          _series = const [];
        }
        if (requestId != _loadRequestId) return;
      }
    } catch (e) {
      if (requestId != _loadRequestId) return;
      _state = ApiState.error(e.toString());
      _series = const [];
    }
    notifyListeners();

    try {
      final result = await _calendarService.getEvents();
      if (requestId != _loadRequestId) return;
      _importantEvents = result.events.where((e) => e.impact != ImpactLevel.low).take(4).toList();
    } catch (_) {
      if (requestId != _loadRequestId) return;
      _importantEvents = const [];
    }
    notifyListeners();

    try {
      final insight = await _aiService.getAssetInsight('XAU/USD');
      if (requestId != _loadRequestId) return;
      _aiState = ApiState.success(insight);
    } catch (e) {
      if (requestId != _loadRequestId) return;
      _aiState = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  Future<void> retry() => _load();
}
