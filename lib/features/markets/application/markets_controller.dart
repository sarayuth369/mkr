import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_fetch_result.dart';
import '../domain/market_service.dart';

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

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  /// 2026-09-15 hardening task: [MarketFetchResult] is mapped to
  /// [ApiState] explicitly per outcome — a provider/offline failure ALWAYS
  /// becomes `ApiState.error(...)`, never `ApiState.empty()`, so the UI can
  /// never show `No markets available` for what was actually a rate limit,
  /// timeout, or malformed response. A partial result still renders as
  /// `ApiState.success` (the valid quotes stay visible) with `isPartial:
  /// true` so the screen can show a non-blocking degraded indicator.
  ///
  /// 2026-09-15 Home/Markets final user-visible audit (item 3): a slower,
  /// older `_load()` call finishing AFTER a newer one must never overwrite
  /// the newer result (e.g. pull-to-refresh tapped twice) - guarded with a
  /// request-generation id, plus a minimal disposal guard before
  /// `notifyListeners()`.
  int _loadRequestId = 0;

  Future<void> _load() async {
    final requestId = ++_loadRequestId;
    _state = const ApiState.loading();
    if (!_disposed) notifyListeners();
    try {
      final result = await _service.getAllQuotes();
      if (requestId != _loadRequestId || _disposed) return;
      _state = switch (result) {
        MarketFetchSuccess(:final quotes) => ApiState.success(quotes, lastUpdated: _service.lastUpdated),
        MarketFetchPartial(:final quotes) => ApiState.success(quotes, lastUpdated: _service.lastUpdated, isPartial: true),
        MarketFetchEmpty() => const ApiState.empty(),
        MarketFetchFailure(:final message) => ApiState.error(message),
      };
    } catch (e) {
      if (requestId != _loadRequestId || _disposed) return;
      _state = ApiState.error(e.toString());
    }
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() => _load();

  void setCategory(AssetClass? category) {
    _category = category;
    notifyListeners();
  }

  void setQuery(String query) {
    _query = query;
    notifyListeners();
  }

  List<MarketQuote> visibleQuotes() {
    final all = _state.dataOrNull ?? const [];
    final q = _query.trim().toLowerCase();
    return all.where((quote) {
      final matchesCategory = _category == null || quote.assetClass == _category;
      final matchesQuery = q.isEmpty ||
          quote.symbol.toLowerCase().contains(q) ||
          quote.name.toLowerCase().contains(q);
      return matchesCategory && matchesQuery;
    }).toList();
  }
}
