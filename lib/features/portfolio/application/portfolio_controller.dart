import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../data/mock_market_catalog.dart';
import '../../../domain/market_quote.dart';
import '../domain/portfolio_calculations.dart';
import '../domain/portfolio_holding.dart';
import '../domain/portfolio_repository.dart';

class PortfolioController extends ChangeNotifier {
  PortfolioController(this._repository) {
    _load();
  }

  final PortfolioRepository _repository;

  ApiState<PortfolioSummary> _state = const ApiState.loading();
  ApiState<PortfolioSummary> get state => _state;

  List<PortfolioHolding> _holdings = [];

  Future<void> _load() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      _holdings = await _repository.getHoldings();
      _recompute();
    } catch (e) {
      _state = ApiState.error(e.toString());
      notifyListeners();
    }
  }

  Future<void> refresh() => _load();

  void _recompute() {
    if (_holdings.isEmpty) {
      _state = const ApiState.empty();
      notifyListeners();
      return;
    }
    final quotes = <String, MarketQuote>{
      for (final q in MockMarketCatalog.all) q.symbol: q,
    };
    _state = ApiState.success(PortfolioCalculations.summarize(_holdings, quotes));
    notifyListeners();
  }

  Future<void> addHolding(PortfolioHolding holding) async {
    _holdings = [..._holdings, holding];
    await _repository.saveHoldings(_holdings);
    _recompute();
  }

  Future<void> removeHolding(String symbol) async {
    _holdings = _holdings.where((h) => h.symbol != symbol).toList();
    await _repository.saveHoldings(_holdings);
    _recompute();
  }
}
