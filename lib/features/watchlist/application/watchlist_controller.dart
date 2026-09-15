import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/market_quote.dart';
import '../../markets/domain/market_fetch_result.dart';
import '../../markets/domain/market_service.dart';
import '../domain/watchlist_repository.dart';

/// 2026-09-15 hardening task: watchlist quotes now come from the real
/// [MarketService] (batched via [MarketService.getQuotesFor]) instead of
/// [MockMarketCatalog] - in real mode the Watchlist previously showed
/// static mock prices for the user's actual saved symbols, never their
/// genuine live quotes.
class WatchlistController extends ChangeNotifier {
  WatchlistController(this._repository, this._marketService) {
    _load();
  }

  final WatchlistRepository _repository;
  final MarketService _marketService;

  ApiState<List<MarketQuote>> _state = const ApiState.loading();
  ApiState<List<MarketQuote>> get state => _state;

  List<String> _symbols = [];
  List<String> get symbols => List.unmodifiable(_symbols);

  Future<void> _load() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      _symbols = await _repository.getSymbols();
      await _emitQuotes();
    } catch (e) {
      _state = ApiState.error(e.toString());
      notifyListeners();
    }
  }

  Future<void> refresh() => _load();

  /// Fetches quotes for exactly the saved symbols in ONE batch request and
  /// maps the typed [MarketFetchResult] to [ApiState] the same way
  /// [MarketsController]/[HomeController] do - a provider/offline failure
  /// becomes `ApiState.error`, never a false `ApiState.empty`.
  Future<void> _emitQuotes() async {
    if (_symbols.isEmpty) {
      _state = const ApiState.empty();
      notifyListeners();
      return;
    }
    try {
      final result = await _marketService.getQuotesFor(_symbols);
      _state = switch (result) {
        MarketFetchSuccess(:final quotes) => ApiState.success(_ordered(quotes)),
        MarketFetchPartial(:final quotes) => ApiState.success(_ordered(quotes), isPartial: true),
        MarketFetchEmpty() => const ApiState.empty(),
        MarketFetchFailure(:final message) => ApiState.error(message),
      };
    } catch (e) {
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
  }

  /// Re-sorts the batch result back into the user's own saved/reordered
  /// order - the backend has no notion of watchlist ordering, and a symbol
  /// whose quote failed is simply absent (matches how every other partial
  /// result already degrades gracefully rather than blocking the rest).
  List<MarketQuote> _ordered(List<MarketQuote> quotes) {
    final bySymbol = {for (final q in quotes) q.symbol: q};
    return _symbols.map((s) => bySymbol[s]).whereType<MarketQuote>().toList();
  }

  bool contains(String symbol) => _symbols.contains(symbol);

  Future<void> add(String symbol) async {
    if (_symbols.contains(symbol)) return;
    _symbols = [..._symbols, symbol];
    await _repository.setSymbols(_symbols);
    await _emitQuotes();
  }

  Future<void> remove(String symbol) async {
    _symbols = _symbols.where((s) => s != symbol).toList();
    await _repository.setSymbols(_symbols);
    await _emitQuotes();
  }

  Future<void> reorder(int oldIndex, int newIndex) async {
    var to = newIndex;
    if (oldIndex < newIndex) to -= 1;
    final updated = List<String>.of(_symbols);
    final item = updated.removeAt(oldIndex);
    updated.insert(to, item);
    _symbols = updated;
    await _repository.setSymbols(_symbols);
    await _emitQuotes();
  }
}
