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
      final events = await _calendarService.getEvents();
      _relatedEvents = events.take(3).toList();
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
    _series = await _marketService.getPriceSeries(symbol, timeframe);
    notifyListeners();
  }

  Future<void> retry() => _load();
}
