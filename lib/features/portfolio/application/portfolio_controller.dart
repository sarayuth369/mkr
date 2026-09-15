import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/market_quote.dart';
import '../../markets/domain/market_service.dart';
import '../domain/portfolio_calculations.dart';
import '../domain/portfolio_holding.dart';
import '../domain/portfolio_repository.dart';

class PortfolioController extends ChangeNotifier {
  PortfolioController(this._repository, this._marketService) {
    _load();
  }

  final PortfolioRepository _repository;
  final MarketService _marketService;

  ApiState<PortfolioSummary> _state = const ApiState.loading();
  ApiState<PortfolioSummary> get state => _state;

  List<PortfolioHolding> _holdings = [];

  Future<void> _load() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      _holdings = await _repository.getHoldings();
      await _recompute();
    } catch (e) {
      _state = ApiState.error(e.toString());
      notifyListeners();
    }
  }

  Future<void> refresh() => _load();

  /// 2026-09-15 FINAL correction task (point 2): displayed valuation/P&L now
  /// comes from one batched [MarketService.getQuotesFor] call for the held
  /// symbols - never `MockMarketCatalog`. [MarketService.getQuotesFor] is
  /// already catalog-authorized and never throws (a real fetch/catalog
  /// fault becomes an empty quote list, not an exception), so a holding
  /// whose quote didn't resolve is never fabricated:
  /// [PortfolioCalculations.summarize] already prices a symbol missing from
  /// the quotes map at cost basis (0 P&L) rather than inventing a value, so
  /// it stays visible with an honest "no live data" outcome instead of
  /// vanishing or showing an invented gain/loss. Demo mode is unaffected -
  /// [MockMarketService]'s [getQuotesFor] already returns
  /// `MockMarketCatalog`-backed quotes for every seeded symbol, exactly
  /// matching prior demo behavior through the same call.
  ///
  /// Only called from [_load]/[addHolding]/[removeHolding] - never from a
  /// widget `build`, so this never turns into a request storm on rebuild.
  Future<void> _recompute() async {
    if (_holdings.isEmpty) {
      _state = const ApiState.empty();
      notifyListeners();
      return;
    }

    final symbols = _holdings.map((h) => h.symbol).toSet().toList();
    final result = await _marketService.getQuotesFor(symbols);
    final quotes = <String, MarketQuote>{
      for (final q in result.quotes) q.symbol: q,
    };

    _state = ApiState.success(PortfolioCalculations.summarize(_holdings, quotes));
    notifyListeners();
  }

  Future<void> addHolding(PortfolioHolding holding) async {
    _holdings = [..._holdings, holding];
    await _repository.saveHoldings(_holdings);
    await _recompute();
  }

  Future<void> removeHolding(String symbol) async {
    _holdings = _holdings.where((h) => h.symbol != symbol).toList();
    await _repository.saveHoldings(_holdings);
    await _recompute();
  }
}
