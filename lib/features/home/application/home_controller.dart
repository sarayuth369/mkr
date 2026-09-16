import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/impact_level.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_symbol_info.dart';
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

  /// 2026-09-16 post-phone Closed Testing correction task (root cause):
  /// Home previously called [MarketService.getAllQuotes] (the WHOLE ~20-
  /// symbol backend catalog) and filtered client-side against these two
  /// hardcoded symbol lists — several of which (`SPX`, `NDX`, `DJI`) were
  /// never even in the real catalog at all. Requesting the entire catalog
  /// on every Home load/refresh vastly exceeds Twelve Data Basic's 8-
  /// credits-per-minute cap for a 20-symbol catalog (confirmed live,
  /// physical-device testing, 2026-09-16) — a large unreliable batch where
  /// most symbols intermittently come back unavailable, which is exactly
  /// the "Home often shows LIVE but no Market Pulse/Snapshot content"
  /// symptom this task exists to fix. Home now derives a SMALL, catalog-
  /// authorized set from [MarketService.getCatalog] instead: the backend's
  /// own `featured` flag first (currently XAU/USD, NVDA, BTC — gold + a US
  /// stock + crypto, preserving the product's "global market exposure +
  /// gold + crypto" intent using symbols already confirmed resolvable),
  /// filled out with the next catalog entries by `sortOrder` only if fewer
  /// than [_snapshotLimit] symbols are featured. A small reliable first-
  /// load set is preferable to a large unreliable one - see [refresh].
  static const int _pulseLimit = 3;
  static const int _snapshotLimit = 6;

  List<String> _selectHomeSymbols(List<MarketSymbolInfo> catalog, int limit) {
    final ordered = [...catalog]..sort((a, b) {
        if (a.featured != b.featured) return a.featured ? -1 : 1;
        return a.sortOrder.compareTo(b.sortOrder);
      });
    return ordered.take(limit).map((s) => s.symbol).toList();
  }

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

  /// Subscribes to live ticks for exactly [symbols] so the Market Pulse /
  /// Market Snapshot rows visibly tick during a session — always sourced
  /// from a service whose [MarketDataMode] is surfaced via the status
  /// chip, so this never implies real-time data that isn't there.
  ///
  /// 2026-09-15 correction task: [symbols] must be the set ALREADY resolved
  /// from a catalog-authorized REST fetch (see [refresh]), never
  /// [_selectHomeSymbols]'s raw output directly — that's a desired hero
  /// selection, not a second production symbol authority, and any entry in
  /// it can be backend-disabled or provider-unavailable at any time.
  /// Requesting a live subscription for an unresolved symbol would bypass
  /// the same backend-catalog rule the initial REST load already enforces.
  /// 2026-09-15 pre-Closed-Testing audit: previously had no `onError`
  /// handler - a genuine live-stream fault (e.g. a catalog re-check inside
  /// [MarketService.watchQuotes] failing) became an unhandled zone error
  /// instead of being caught anywhere. Unlike [MarketDetailController]
  /// (a single quote), Home shows a whole grid of already-successfully-
  /// loaded cards - replacing all of it with a full-screen error just
  /// because the live ticker specifically hiccuped would be a worse
  /// regression than leaving the already-correct REST-loaded data visible,
  /// so this only logs (matching the same lightweight convention already
  /// used in `AlertsController`) rather than fabricating a trigger or
  /// discarding good data; [mode]/[lastUpdated] (the status chip) remain
  /// the honest signal that live updates have stopped.
  void _watchLiveQuotes(List<String> symbols) {
    _liveSubscription?.cancel();
    if (symbols.isEmpty) return; // nothing currently resolvable - omit honestly, never subscribe to a guess
    _liveSubscription = _marketService.watchQuotes(symbols).listen(
      (updates) {
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
      },
      onError: (Object e) => debugPrint('[MKR home] live quote stream error: $e'),
    );
  }

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    _liveSubscription?.cancel();
    super.dispose();
  }

  /// 2026-09-15 Home/Markets final user-visible audit (item 3): a slower,
  /// older [refresh] call finishing AFTER a newer one must never overwrite
  /// the newer (possibly already-successful) result - e.g. pull-to-refresh
  /// tapped twice in quick succession, or a retry racing the initial load.
  /// Each phase below checks [_refreshRequestId] before applying its
  /// result and bails out (also covering [_disposed] - a defensive,
  /// minimal guard against `notifyListeners()` after disposal, even though
  /// today's DI wiring keeps this controller alive for the whole app
  /// session) rather than calling `notifyListeners()` on stale/discarded
  /// data.
  int _refreshRequestId = 0;

  Future<void> refresh() async {
    final requestId = ++_refreshRequestId;
    _pulseState = const ApiState.loading();
    _snapshotState = const ApiState.loading();
    _radarState = const ApiState.loading();
    _briefState = const ApiState.loading();
    if (!_disposed) notifyListeners();

    // 2026-09-15 hardening task: a provider/offline failure becomes
    // ApiState.error for BOTH curated sections - never silently rendered
    // as an empty/success state just because Home only shows a filtered
    // subset of the full catalog result.
    //
    // 2026-09-16 post-phone Closed Testing correction task (root cause):
    // getCatalog() (no provider cost) then ONE getQuotesFor() call for a
    // small catalog-derived set (see _selectHomeSymbols) - never the whole
    // catalog via getAllQuotes(). A catalog-load fault surfaces via the
    // same catch block below as any other real fetch fault.
    try {
      final catalog = await _marketService.getCatalog();
      if (requestId != _refreshRequestId || _disposed) return;
      final homeSymbols = _selectHomeSymbols(catalog, _snapshotLimit);
      final pulseSymbolSet = homeSymbols.take(_pulseLimit).toSet();

      final result = await _marketService.getQuotesFor(homeSymbols);
      if (requestId != _refreshRequestId || _disposed) return;
      switch (result) {
        case MarketFetchSuccess(:final quotes):
        case MarketFetchPartial(:final quotes):
          final bySymbol = {for (final q in quotes) q.symbol: q};
          final isPartial = result is MarketFetchPartial;
          // Only symbols that ACTUALLY resolved from the catalog-authorized
          // fetch above - a desired hero symbol that's currently disabled/
          // unavailable is simply omitted here, never requested anyway.
          final resolvedPulse = [for (final s in homeSymbols) if (pulseSymbolSet.contains(s)) bySymbol[s]].whereType<MarketQuote>().toList();
          final resolvedSnapshot = [for (final s in homeSymbols) bySymbol[s]].whereType<MarketQuote>().toList();
          _pulseState = ApiState.success(resolvedPulse, isPartial: isPartial);
          _snapshotState = ApiState.success(resolvedSnapshot, isPartial: isPartial);
          // The first resolved gold-class quote, never a hardcoded ticker -
          // stays correct if the backend catalog's gold symbol ever changes.
          _gold = quotes.cast<MarketQuote?>().firstWhere((q) => q?.assetClass == AssetClass.gold, orElse: () => null);
          // 2026-09-15 correction task: watch exactly what resolved above,
          // never a raw hardcoded symbol selection - see
          // _watchLiveQuotes' doc comment.
          _watchLiveQuotes({...resolvedPulse.map((q) => q.symbol), ...resolvedSnapshot.map((q) => q.symbol)}.toList());
        case MarketFetchEmpty():
          _pulseState = const ApiState.empty();
          _snapshotState = const ApiState.empty();
        case MarketFetchFailure(:final message):
          _pulseState = ApiState.error(message);
          _snapshotState = ApiState.error(message);
      }
    } catch (e) {
      if (requestId != _refreshRequestId || _disposed) return;
      _pulseState = ApiState.error(e.toString());
      _snapshotState = ApiState.error(e.toString());
    }
    if (!_disposed) notifyListeners();

    try {
      final result = await _calendarService.getEvents();
      if (requestId != _refreshRequestId || _disposed) return;
      final today = DateTime.now();
      final todays = result.events.where((e) =>
          e.dateTime.year == today.year && e.dateTime.month == today.month && e.dateTime.day == today.day);
      final items = todays
          .map((e) => RadarItem(title: e.title, time: e.dateTime, impact: e.impact, subtitle: e.country))
          .toList()
        ..sort((a, b) => a.impact.sortWeight.compareTo(b.impact.sortWeight));
      _radarState = items.isEmpty ? const ApiState.empty() : ApiState.success(items);
    } catch (e) {
      if (requestId != _refreshRequestId || _disposed) return;
      _radarState = ApiState.error(e.toString());
    }
    if (!_disposed) notifyListeners();

    try {
      final brief = await _aiService.getDailyBrief();
      if (requestId != _refreshRequestId || _disposed) return;
      _briefState = ApiState.success(brief);
    } catch (e) {
      if (requestId != _refreshRequestId || _disposed) return;
      _briefState = ApiState.error(e.toString());
    }
    if (!_disposed) notifyListeners();
  }
}
