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

  /// 2026-09-16 Final Full-System One-Pass audit finding: this controller is
  /// created fresh per detail-screen visit (not an app-lifetime singleton
  /// like Home/Markets), so `dispose()` fires for real on back-navigation.
  /// `_load()` chains five awaited calls each followed by `notifyListeners()`
  /// - without this guard, backing out while any of them is still in flight
  /// throws "A ChangeNotifier was used after being disposed" once that
  /// continuation resumes.
  bool _disposed = false;

  /// 2026-09-15 pre-Closed-Testing audit (Known Issue B): previously had no
  /// `onError` handler, so a genuine live-stream fault (e.g. the catalog
  /// re-check inside [MarketService.watchQuotes] failing) became an
  /// unhandled zone error and left [_quoteState] stuck at whatever it was
  /// before - looking "live" forever with no indication the subscription
  /// actually died. Now surfaces honestly as [ApiState.error] (the same
  /// error+retry UI this screen already uses everywhere else), rather than
  /// silently going stale with no signal.
  void _watchLiveQuote() {
    _liveSubscription?.cancel();
    _liveSubscription = _marketService.watchQuotes([symbol]).listen(
      (updates) {
        if (_disposed || updates.isEmpty) return;
        final live = updates.first;
        _quoteState = ApiState.success(live, lastUpdated: _marketService.lastUpdated);
        if (_series.isNotEmpty && _timeframe == ChartTimeframe.d1) {
          _series = [..._series]..[_series.length - 1] = live.price;
        }
        notifyListeners();
      },
      onError: (Object e) {
        if (_disposed) return;
        _quoteState = ApiState.error(e.toString());
        notifyListeners();
      },
    );
  }

  @override
  void dispose() {
    _disposed = true;
    _liveSubscription?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    _quoteState = const ApiState.loading();
    _aiState = const ApiState.loading();
    notifyListeners();

    try {
      final quote = await _marketService.getQuote(symbol);
      if (_disposed) return;
      _quoteState = quote == null ? const ApiState.empty() : ApiState.success(quote);
      if (quote != null) _watchLiveQuote();
    } catch (e) {
      if (_disposed) return;
      _quoteState = ApiState.error(e.toString());
    }
    notifyListeners();

    await loadSeries(_timeframe);
    if (_disposed) return;

    try {
      final result = await _calendarService.getEvents();
      if (_disposed) return;
      _relatedEvents = result.events.take(3).toList();
    } catch (_) {
      if (_disposed) return;
      _relatedEvents = const [];
    }

    try {
      _relatedNews = await _newsService.getRelatedTo(symbol);
      if (_disposed) return;
    } catch (_) {
      if (_disposed) return;
      _relatedNews = const [];
    }
    notifyListeners();

    try {
      final insight = await _aiService.getAssetInsight(symbol);
      if (_disposed) return;
      _aiState = ApiState.success(insight);
    } catch (e) {
      if (_disposed) return;
      _aiState = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  /// 2026-09-15 pre-Closed-Testing audit (Known Issue C): rapidly switching
  /// timeframe (tapping "1W" then "1M" before the first fetch resolves)
  /// used to let the slower, now-stale "1W" response land AFTER the faster
  /// "1M" one and silently overwrite it - `_timeframe` would read "1M" while
  /// `_series` held "1W" data, an inconsistent state the UI can't detect.
  /// `_seriesRequestId` makes each call's result apply only if no newer
  /// [loadSeries] call has started since - a late/stale response is
  /// discarded instead of applied.
  int _seriesRequestId = 0;

  Future<void> loadSeries(ChartTimeframe timeframe) async {
    _timeframe = timeframe;
    final requestId = ++_seriesRequestId;
    List<double> series = const [];
    var unavailable = false;
    try {
      series = await _marketService.getPriceSeries(symbol, timeframe);
    } catch (_) {
      series = const [];
      unavailable = true;
    }
    if (requestId != _seriesRequestId) return; // a newer request has since started - discard this stale result
    if (_disposed) return;
    _series = series;
    _seriesUnavailable = unavailable;
    notifyListeners();
  }

  Future<void> retry() => _load();
}
