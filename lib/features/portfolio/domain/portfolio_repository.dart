import 'portfolio_holding.dart';

abstract class PortfolioRepository {
  Future<List<PortfolioHolding>> getHoldings();

  Future<void> saveHoldings(List<PortfolioHolding> holdings);
}
