import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/impact_level.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/radar_item.dart';
import '../../ai/domain/ai_insight.dart';
import '../../ai/domain/market_ai_service.dart';
import '../../calendar/domain/economic_calendar_service.dart';
import '../../markets/domain/market_fetch_result.dart';
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

  /// Market Pulse — the 3 featured hero cards.
  static const pulseSymbols = ['SPX', 'XAU/USD', 'BTC'];

  /// Market Snapshot — compact list of the major markets at a glance.
  static const snapshotSymbols = ['SPX', 'NDX', 'DJI', 'BTC', 'XAU/USD', 'SET'];

  MarketDataMode get mode => _marketService.mode;
  DateTime? get lastUpdated => _marketService.lastUpdated;

  ApiState<List<MarketQuote>> _pulseState = const ApiState.loading();
  ApiState<List<MarketQuote>> get pulseState => _pulseState;

  ApiState<List<MarketQuote>> _snapshotState = const ApiState.loading();
  ApiState<List<MarketQuote>> get snapshotState => _snapshotState;

  MarketQuote? _gold;
  MarketQuote? get gold => _gold;

  ApiState<List<RadarItem>> _radarState = const ApiState.loading();
  ApiState<List<RadarItem>> get radarState => _radarState;

  ApiState<AIInsight> _briefState = const ApiState.loading();
  ApiState<AIInsight> get briefState => _briefState;

  StreamSubscription<List<MarketQuote>>? _liveSubscription;

  /// Subscribes Home's visible symbols to [MarketService.watchQuotes] so the
  /// Market Pulse / Market Snapshot rows visibly tick during a session —
  /// always sourced from a service whose [MarketDataMode] is surfaced via
  /// the status chip, so this never implies real-time data that isn't there.
  void _watchLiveQuotes() {
    final symbols = {...pulseSymbols, ...snapshotSymbols}.toList();
    _liveSubscription?.cancel();
    _liveSubscription = _marketService.watchQuotes(symbols).listen((updates) {
      final bySymbol = {for (final q in updates) q.symbol: q};

      final pulse = _pulseState.dataOrNull;
      if (pulse != null) {
        _pulseState = ApiState.success(
          [for (final q in pulse) bySymbol[q.symbol] ?? q],
          lastUpdated: _marketService.lastUpdated,
        );
      }

      final snapshot = _snapshotState.dataOrNull;
      if (snapshot != null) {
        _snapshotState = ApiState.success(
          [for (final q in snapshot) bySymbol[q.symbol] ?? q],
          lastUpdated: _marketService.lastUpdated,
        );
      }

      if (_gold != null && bySymbol.containsKey(_gold!.symbol)) {
        _gold = bySymbol[_gold!.symbol];
      }

      notifyListeners();
    });
  }

  @override
  void dispose() {
    _liveSubscription?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    _pulseState = const ApiState.loading();
    _snapshotState = const ApiState.loading();
    _radarState = const ApiState.loading();
    _briefState = const ApiState.loading();
    notifyListeners();

    // 2026-09-15 hardening task: a provider/offline failure becomes
    // ApiState.error for BOTH curated sections - never silently rendered
    // as an empty/success state just because Home only shows a filtered
    // subset of the full catalog result.
    try {
      final result = await _marketService.getAllQuotes();
      switch (result) {
        case MarketFetchSuccess(:final quotes):
        case MarketFetchPartial(:final quotes):
          final bySymbol = {for (final q in quotes) q.symbol: q};
          final isPartial = result is MarketFetchPartial;
          _pulseState = ApiState.success(
            [for (final s in pulseSymbols) bySymbol[s]].whereType<MarketQuote>().toList(),
            isPartial: isPartial,
          );
          _snapshotState = ApiState.success(
            [for (final s in snapshotSymbols) bySymbol[s]].whereType<MarketQuote>().toList(),
            isPartial: isPartial,
          );
          _gold = bySymbol['XAU/USD'];
          _watchLiveQuotes();
        case MarketFetchEmpty():
          _pulseState = const ApiState.empty();
          _snapshotState = const ApiState.empty();
        case MarketFetchFailure(:final message):
          _pulseState = ApiState.error(message);
          _snapshotState = ApiState.error(message);
      }
    } catch (e) {
      _pulseState = ApiState.error(e.toString());
      _snapshotState = ApiState.error(e.toString());
    }
    notifyListeners();

    try {
      final result = await _calendarService.getEvents();
      final today = DateTime.now();
      final todays = result.events.where((e) =>
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
