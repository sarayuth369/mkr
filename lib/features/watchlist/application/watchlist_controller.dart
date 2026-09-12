import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/market_quote.dart';
import '../domain/watchlist_repository.dart';

class WatchlistController extends ChangeNotifier {
  WatchlistController(this._repository) {
    _load();
  }

  final WatchlistRepository _repository;

  ApiState<List<MarketQuote>> _state = const ApiState.loading();
  ApiState<List<MarketQuote>> get state => _state;

  List<String> _symbols = [];
  List<String> get symbols => List.unmodifiable(_symbols);

  Future<void> _load() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      _symbols = await _repository.getSymbols();
      _emitQuotes();
    } catch (e) {
      _state = ApiState.error(e.toString());
      notifyListeners();
    }
  }

  Future<void> refresh() => _load();

  void _emitQuotes() {
    final quotes = _symbols
        .map(MockMarketCatalog.bySymbol)
        .whereType<MarketQuote>()
        .toList();
    _state = quotes.isEmpty ? const ApiState.empty() : ApiState.success(quotes);
    notifyListeners();
  }

  bool contains(String symbol) => _symbols.contains(symbol);

  Future<void> add(String symbol) async {
    if (_symbols.contains(symbol)) return;
    _symbols = [..._symbols, symbol];
    await _repository.setSymbols(_symbols);
    _emitQuotes();
  }

  Future<void> remove(String symbol) async {
    _symbols = _symbols.where((s) => s != symbol).toList();
    await _repository.setSymbols(_symbols);
    _emitQuotes();
  }

  Future<void> reorder(int oldIndex, int newIndex) async {
    var to = newIndex;
    if (oldIndex < newIndex) to -= 1;
    final updated = List<String>.of(_symbols);
    final item = updated.removeAt(oldIndex);
    updated.insert(to, item);
    _symbols = updated;
    await _repository.setSymbols(_symbols);
    _emitQuotes();
  }
}
