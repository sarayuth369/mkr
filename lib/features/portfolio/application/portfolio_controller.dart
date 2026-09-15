import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../../../domain/market_quote.dart';
import '../../markets/domain/market_fetch_result.dart';
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
  /// already catalog-authorized, so a holding whose quote didn't resolve
  /// individually is never fabricated: [PortfolioCalculations.summarize]
  /// already prices a symbol missing from the quotes map at cost basis (0
  /// P&L) rather than inventing a value.
  ///
  /// Only called from [_load]/[addHolding]/[removeHolding] - never from a
  /// widget `build`, so this never turns into a request storm on rebuild.
  ///
  /// 2026-09-15 FINAL FINAL correction task (Defect 1): the [MarketFetchResult]
  /// itself is now mapped explicitly rather than blindly always building
  /// [ApiState.success] from `result.quotes` - a provider-wide
  /// [MarketFetchFailure] must never look like a normal successful
  /// valuation just because an empty quote map still prices every holding
  /// at cost basis:
  /// - [MarketFetchSuccess]: every held symbol resolved, fully live -
  ///   `isPartial: false`.
  /// - [MarketFetchPartial]: some resolved, the rest honestly fall back to
  ///   cost basis inside [PortfolioCalculations] - `isPartial: true` flags
  ///   the screen as degraded without hiding the valid data that DID load.
  /// - [MarketFetchEmpty]: no symbol resolved at all (e.g. none of the held
  ///   symbols are currently catalog-enabled) - holdings are still real and
  ///   shown at cost basis, but this is not a live fetch either, so it is
  ///   flagged the same way as a partial result rather than silently
  ///   looking identical to a fully-live one.
  /// - [MarketFetchFailure]: [ApiState.error] - never [ApiState.success].
  Future<void> _recompute() async {
    if (_holdings.isEmpty) {
      _state = const ApiState.empty();
      notifyListeners();
      return;
    }

    final symbols = _holdings.map((h) => h.symbol).toSet().toList();
    final result = await _marketService.getQuotesFor(symbols);

    if (result is MarketFetchFailure) {
      _state = ApiState.error(result.message);
      notifyListeners();
      return;
    }

    final quotes = <String, MarketQuote>{
      for (final q in result.quotes) q.symbol: q,
    };
    _state = ApiState.success(
      PortfolioCalculations.summarize(_holdings, quotes),
      isPartial: result is! MarketFetchSuccess,
    );
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
