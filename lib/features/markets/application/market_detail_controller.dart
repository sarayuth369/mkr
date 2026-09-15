import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../core/widgets/price_chart.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../ai/domain/ai_insight.dart';
import '../../ai/domain/market_ai_service.dart';
import '../../calendar/domain/economic_calendar_service.dart';
import '../../calendar/domain/economic_event.dart';
import '../../news/domain/news_article.dart';
import '../../news/domain/news_service.dart';
import '../domain/market_service.dart';

class MarketDetailController extends ChangeNotifier {
  MarketDetailController({
    required this.symbol,
    required MarketService marketService,
    required MarketAIService aiService,
    required NewsService newsService,
    required EconomicCalendarService calendarService,
  })  : _marketService = marketService,
        _aiService = aiService,
        _newsService = newsService,
        _calendarService = calendarService {
    _load();
  }

  final String symbol;
  final MarketService _marketService;
  final MarketAIService _aiService;
  final NewsService _newsService;
  final EconomicCalendarService _calendarService;

  MarketDataMode get mode => _marketService.mode;
  DateTime? get lastUpdated => _marketService.lastUpdated;

  ApiState<MarketQuote> _quoteState = const ApiState.loading();
  ApiState<MarketQuote> get quoteState => _quoteState;

  List<double> _series = const [];
  List<double> get series => _series;

  /// True only when the last [loadSeries] failed because of a genuine
  /// catalog/provider fault - never for "this symbol has no history", which
  /// stays a plain empty [series]. Lets the screen tell the two apart
  /// instead of treating a real failure as a valid empty chart (2026-09-15
  /// FINAL correction task, point 4).
  bool _seriesUnavailable = false;
  bool get seriesUnavailable => _seriesUnavailable;

  ApiState<AIInsight> _aiState = const ApiState.loading();
  ApiState<AIInsight> get aiState => _aiState;

  List<NewsArticle> _relatedNews = const [];
  List<NewsArticle> get relatedNews => _relatedNews;

  List<EconomicEvent> _relatedEvents = const [];
  List<EconomicEvent> get relatedEvents => _relatedEvents;

  ChartTimeframe _timeframe = ChartTimeframe.d1;
  ChartTimeframe get timeframe => _timeframe;

  StreamSubscription<List<MarketQuote>>? _liveSubscription;

  void _watchLiveQuote() {
    _liveSubscription?.cancel();
    _liveSubscription = _marketService.watchQuotes([symbol]).listen((updates) {
      if (updates.isEmpty) return;
      final live = updates.first;
      _quoteState = ApiState.success(live, lastUpdated: _marketService.lastUpdated);
      if (_series.isNotEmpty && _timeframe == ChartTimeframe.d1) {
        _series = [..._series]..[_series.length - 1] = live.price;
      }
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _liveSubscription?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    _quoteState = const ApiState.loading();
    _aiState = const ApiState.loading();
    notifyListeners();

    try {
      final quote = await _marketService.getQuote(symbol);
      _quoteState = quote == null ? const ApiState.empty() : ApiState.success(quote);
      if (quote != null) _watchLiveQuote();
    } catch (e) {
      _quoteState = ApiState.error(e.toString());
    }
    notifyListeners();

    await loadSeries(_timeframe);

    try {
      final result = await _calendarService.getEvents();
      _relatedEvents = result.events.take(3).toList();
    } catch (_) {
      _relatedEvents = const [];
    }

    try {
      _relatedNews = await _newsService.getRelatedTo(symbol);
    } catch (_) {
      _relatedNews = const [];
    }
    notifyListeners();

    try {
      final insight = await _aiService.getAssetInsight(symbol);
      _aiState = ApiState.success(insight);
    } catch (e) {
      _aiState = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  Future<void> loadSeries(ChartTimeframe timeframe) async {
    _timeframe = timeframe;
    try {
      _series = await _marketService.getPriceSeries(symbol, timeframe);
      _seriesUnavailable = false;
    } catch (_) {
      _series = const [];
      _seriesUnavailable = true;
    }
    notifyListeners();
  }

  Future<void> retry() => _load();
}
