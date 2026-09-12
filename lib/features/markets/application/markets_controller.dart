import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/asset_class.dart';
import '../../../domain/market_quote.dart';
import '../domain/market_service.dart';

class MarketsController extends ChangeNotifier {
  MarketsController(this._service) {
    _load();
  }

  final MarketService _service;

  ApiState<List<MarketQuote>> _state = const ApiState.loading();
  ApiState<List<MarketQuote>> get state => _state;

  AssetClass? _category;
  AssetClass? get category => _category;

  String _query = '';
  String get query => _query;

  Future<void> _load() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      final quotes = await _service.getAllQuotes();
      _state = quotes.isEmpty ? const ApiState.empty() : ApiState.success(quotes);
    } catch (e) {
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
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
