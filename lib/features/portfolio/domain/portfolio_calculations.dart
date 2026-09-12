import '../../../domain/market_quote.dart';
import 'portfolio_holding.dart';

class PortfolioLine {
  const PortfolioLine({
    required this.holding,
    required this.currentPrice,
    required this.marketValue,
    required this.costBasis,
    required this.totalPL,
    required this.totalPLPct,
    required this.dailyPL,
  });

  final PortfolioHolding holding;
  final double currentPrice;
  final double marketValue;
  final double costBasis;
  final double totalPL;
  final double totalPLPct;
  final double dailyPL;
}

class PortfolioSummary {
  const PortfolioSummary({
    required this.lines,
    required this.totalValue,
    required this.totalCost,
    required this.totalPL,
    required this.totalPLPct,
    required this.dailyPL,
  });

  final List<PortfolioLine> lines;
  final double totalValue;
  final double totalCost;
  final double totalPL;
  final double totalPLPct;
  final double dailyPL;

  Map<String, double> allocationBySymbol() {
    if (totalValue <= 0) return {};
    return {
      for (final line in lines) line.holding.symbol: line.marketValue / totalValue,
    };
  }
}

/// Pure calculation layer — no widget/repository dependency, so it is fully
/// unit-testable in isolation.
class PortfolioCalculations {
  PortfolioCalculations._();

  static PortfolioSummary summarize(
    List<PortfolioHolding> holdings,
    Map<String, MarketQuote> quotes,
  ) {
    final lines = <PortfolioLine>[];
    for (final holding in holdings) {
      final quote = quotes[holding.symbol];
      final currentPrice = quote?.price ?? holding.avgPrice;
      final marketValue = currentPrice * holding.quantity;
      final costBasis = holding.avgPrice * holding.quantity;
      final totalPL = marketValue - costBasis;
      final totalPLPct = costBasis == 0 ? 0.0 : (totalPL / costBasis) * 100;
      final dailyPL = (quote?.changeAbs ?? 0) * holding.quantity;
      lines.add(PortfolioLine(
        holding: holding,
        currentPrice: currentPrice,
        marketValue: marketValue,
        costBasis: costBasis,
        totalPL: totalPL,
        totalPLPct: totalPLPct,
        dailyPL: dailyPL,
      ));
    }

    final totalValue = lines.fold(0.0, (sum, l) => sum + l.marketValue);
    final totalCost = lines.fold(0.0, (sum, l) => sum + l.costBasis);
    final totalPL = totalValue - totalCost;
    final totalPLPct = totalCost == 0 ? 0.0 : (totalPL / totalCost) * 100;
    final dailyPL = lines.fold(0.0, (sum, l) => sum + l.dailyPL);

    return PortfolioSummary(
      lines: lines,
      totalValue: totalValue,
      totalCost: totalCost,
      totalPL: totalPL,
      totalPLPct: totalPLPct,
      dailyPL: dailyPL,
    );
  }
}
