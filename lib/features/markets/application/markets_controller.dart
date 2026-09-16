import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_symbol_info.dart';
import '../domain/market_fetch_result.dart';
import '../domain/market_service.dart';

/// 2026-09-16 post-phone Closed Testing correction task (root cause):
/// Markets previously called [MarketService.getAllQuotes] (the WHOLE ~20-
/// symbol backend catalog) on every page open/refresh, then filtered
/// purely client-side. Requesting the entire catalog vastly exceeds Twelve
/// Data Basic's 8-credits-per-minute cap for MKR's catalog (confirmed live,
/// physical-device testing, 2026-09-16) - a large unreliable batch where
/// most symbols intermittently come back unavailable, which is exactly the
/// "Markets sometimes shows only EUR/USD... No markets available" symptom
/// this task exists to fix.
///
/// Redesigned as catalog-first + controlled/lazy loading:
/// - [MarketService.getCatalog] (no provider cost) loads the full symbol
///   universe up front, so every catalog symbol's IDENTITY is known
///   immediately, before any quote is requested.
/// - Only a small controlled initial subset (featured symbols first, filled
///   to [_pageSize] by catalog order) is quoted on first load - not the
///   whole catalog.
/// - Selecting a category or typing a search query fetches ONLY the
///   quotes still missing for that filter (see [_ensureQuotes]) - a
///   catalog symbol not part of the initial page is still discoverable,
///   it's fetched on demand instead of only ever being filtered out of
///   data that was never requested.
/// - Every fetched quote is accumulated in [_quotes] and never discarded
///   on a category/search change, so switching back to a previously-
///   viewed filter shows already-known data instantly with no re-fetch.
/// - Every fetch is ONE batched [MarketService.getQuotesFor] call
///   (never N individual `/quote` calls per symbol), capped at
///   [_maxSymbolsPerFetch] so a single user action can never burst past
///   what the provider can actually serve in one request.
class MarketsController extends ChangeNotifier {
  MarketsController(this._service) {
    _load();
  }

  final MarketService _service;

  MarketDataMode get mode => _service.mode;
  DateTime? get lastUpdated => _service.lastUpdated;

  ApiState<List<MarketQuote>> _state = const ApiState.loading();
  ApiState<List<MarketQuote>> get state => _state;

  AssetClass? _category;
  AssetClass? get category => _category;

  String _query = '';
  String get query => _query;

  bool _disposed = false;

  /// The full symbol universe, loaded once via [MarketService.getCatalog].
  List<MarketSymbolInfo> _catalog = [];

  /// Every quote successfully resolved so far this session, keyed by
  /// symbol - accumulates across category/search changes, never cleared
  /// except by a real [refresh].
  final Map<String, MarketQuote> _quotes = {};

  /// Symbols that were requested and genuinely came back with no data
  /// (catalog-disabled, or the provider itself has nothing for them) -
  /// distinct from a symbol simply never requested yet.
  final Set<String> _unavailable = {};

  /// The most recent hard fetch fault (provider/offline), if any - reset
  /// at the start of every new [_ensureQuotes] attempt so a stale error
  /// from an unrelated earlier filter never lingers into a later,
  /// genuinely successful view.
  String? _lastFetchError;

  /// One backend chunk's worth (see `TwelveDataProvider.BATCH_CHUNK_SIZE`
  /// server-side) - the initial page is deliberately this small rather
  /// than the whole catalog.
  static const int _pageSize = 8;

  /// Caps every single [_ensureQuotes] call, including a category/search
  /// selection that could otherwise match more symbols than one request
  /// should safely carry - "do not create N simultaneous provider requests
  /// from one user action" applies to request SIZE, not just call count.
  static const int _maxSymbolsPerFetch = 8;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  /// 2026-09-15 Home/Markets final user-visible audit (item 3)'s request-
  /// generation guard, reused here: a slower, older fetch finishing after a
  /// newer one must never overwrite the newer result.
  int _loadRequestId = 0;

  List<MarketSymbolInfo> _matchingCatalog() {
    final q = _query.trim().toLowerCase();
    return _catalog.where((s) {
      final matchesCategory = _category == null || s.assetClass == _category;
      final matchesQuery = q.isEmpty || s.symbol.toLowerCase().contains(q) || s.displayName.toLowerCase().contains(q);
      return matchesCategory && matchesQuery;
    }).toList();
  }

  List<String> _initialPage(List<MarketSymbolInfo> catalog) {
    final ordered = [...catalog]..sort((a, b) {
        if (a.featured != b.featured) return a.featured ? -1 : 1;
        return a.sortOrder.compareTo(b.sortOrder);
      });
    return ordered.take(_pageSize).map((s) => s.symbol).toList();
  }

  Future<void> _load() async {
    final requestId = ++_loadRequestId;
    _state = const ApiState.loading();
    if (!_disposed) notifyListeners();

    final List<MarketSymbolInfo> catalog;
    try {
      catalog = await _service.getCatalog();
    } catch (e) {
      if (requestId != _loadRequestId || _disposed) return;
      _state = ApiState.error(e.toString());
      if (!_disposed) notifyListeners();
      return;
    }
    if (requestId != _loadRequestId || _disposed) return;
    _catalog = catalog;
    await _ensureQuotes(_initialPage(catalog), requestId);
  }

  /// A real retry of exactly what's currently visible (not a reset back to
  /// the generic initial page, which would discard an active category/
  /// search view) - clears [_unavailable] for the current view's symbols
  /// first so a previously-unresolved symbol gets an honest fresh attempt.
  Future<void> refresh() async {
    if (_catalog.isEmpty) {
      await _load();
      return;
    }
    final requestId = ++_loadRequestId;
    final wanted = _matchingCatalog().map((s) => s.symbol).toList();
    _unavailable.removeAll(wanted);
    await _ensureQuotes(wanted, requestId, force: true);
  }

  void setCategory(AssetClass? category) {
    if (category == _category) return;
    _category = category;
    unawaited(_ensureQuotes(_matchingCatalog().map((s) => s.symbol).toList(), ++_loadRequestId));
  }

  void setQuery(String query) {
    if (query == _query) return;
    _query = query;
    unawaited(_ensureQuotes(_matchingCatalog().map((s) => s.symbol).toList(), ++_loadRequestId));
  }

  /// Fetches quotes for [symbols] not already known (or, when [force] is
  /// set, for every symbol in [symbols] regardless) - ONE batched
  /// [MarketService.getQuotesFor] call, capped at [_maxSymbolsPerFetch].
  /// Results merge into [_quotes]/[_unavailable]; nothing already resolved
  /// is ever discarded by a later call for a different filter.
  Future<void> _ensureQuotes(List<String> symbols, int requestId, {bool force = false}) async {
    final targets = (force ? symbols : symbols.where((s) => !_quotes.containsKey(s) && !_unavailable.contains(s)).toList()).take(_maxSymbolsPerFetch).toList();

    if (targets.isEmpty) {
      if (requestId != _loadRequestId || _disposed) return;
      _recompute();
      if (!_disposed) notifyListeners();
      return;
    }

    _lastFetchError = null;
    if (requestId == _loadRequestId && !_disposed) {
      _state = const ApiState.loading();
      notifyListeners();
    }

    try {
      final result = await _service.getQuotesFor(targets);
      if (requestId != _loadRequestId || _disposed) return;
      switch (result) {
        case MarketFetchSuccess(:final quotes):
          for (final q in quotes) {
            _quotes[q.symbol] = q;
            _unavailable.remove(q.symbol);
          }
        case MarketFetchPartial(:final quotes, :final failedSymbols):
          for (final q in quotes) {
            _quotes[q.symbol] = q;
            _unavailable.remove(q.symbol);
          }
          _unavailable.addAll(failedSymbols);
        case MarketFetchEmpty():
          _unavailable.addAll(targets);
        case MarketFetchFailure(:final message):
          _lastFetchError = message;
      }
    } catch (e) {
      if (requestId != _loadRequestId || _disposed) return;
      _lastFetchError = e.toString();
    }

    if (requestId != _loadRequestId || _disposed) return;
    _recompute();
    if (!_disposed) notifyListeners();
  }

  /// 2026-09-15 hardening task: a provider/offline failure ALWAYS becomes
  /// `ApiState.error(...)`, never `ApiState.empty()`, so the UI can never
  /// show `No markets available` for what was actually a rate limit,
  /// timeout, or malformed response. A partial result still renders as
  /// `ApiState.success` (the valid quotes stay visible) with `isPartial:
  /// true` so the screen can show a non-blocking degraded indicator.
  void _recompute() {
    final visible = _matchingCatalog();
    final resolved = [for (final s in visible) if (_quotes.containsKey(s.symbol)) _quotes[s.symbol]!];
    final anyUnavailable = visible.any((s) => _unavailable.contains(s.symbol));
    if (resolved.isEmpty && _lastFetchError != null) {
      _state = ApiState.error(_lastFetchError!);
    } else if (resolved.isEmpty) {
      _state = const ApiState.empty();
    } else {
      _state = ApiState.success(resolved, lastUpdated: _service.lastUpdated, isPartial: anyUnavailable || _lastFetchError != null);
    }
  }

  List<MarketQuote> visibleQuotes() => _state.dataOrNull ?? const [];
}
