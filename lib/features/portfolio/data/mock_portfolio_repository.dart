import '../../../core/persistence/app_local_store.dart';
import '../domain/portfolio_holding.dart';
import '../domain/portfolio_repository.dart';

class MockPortfolioRepository implements PortfolioRepository {
  MockPortfolioRepository(this._store);

  final AppLocalStore _store;

  @override
  Future<List<PortfolioHolding>> getHoldings() async {
    final raw = _store.portfolioHoldingsJson;
    if (raw == null) return [];
    return raw.map(PortfolioHolding.fromJson).toList();
  }

  @override
  Future<void> saveHoldings(List<PortfolioHolding> holdings) {
    return _store.setPortfolioHoldingsJson(holdings.map((h) => h.toJson()).toList());
  }
}
