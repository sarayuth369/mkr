import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/features/portfolio/domain/portfolio_calculations.dart';
import 'package:mkr/features/portfolio/domain/portfolio_holding.dart';

void main() {
  const nvda = MarketQuote(
    symbol: 'NVDA',
    name: 'NVIDIA Corp',
    assetClass: AssetClass.usStock,
    price: 200,
    changeAbs: 10,
    changePct: 5.26,
  );
  const btc = MarketQuote(
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: AssetClass.crypto,
    price: 100000,
    changeAbs: -2000,
    changePct: -1.96,
  );

  test('summarizes a single holding correctly', () {
    final summary = PortfolioCalculations.summarize(
      [const PortfolioHolding(symbol: 'NVDA', quantity: 10, avgPrice: 150)],
      {'NVDA': nvda},
    );

    expect(summary.totalValue, 2000);
    expect(summary.totalCost, 1500);
    expect(summary.totalPL, 500);
    expect(summary.totalPLPct, closeTo(33.33, 0.01));
    expect(summary.dailyPL, 100);
  });

  test('aggregates multiple holdings and computes allocation', () {
    final summary = PortfolioCalculations.summarize(
      [
        const PortfolioHolding(symbol: 'NVDA', quantity: 10, avgPrice: 150),
        const PortfolioHolding(symbol: 'BTC', quantity: 0.02, avgPrice: 90000),
      ],
      {'NVDA': nvda, 'BTC': btc},
    );

    expect(summary.totalValue, 2000 + 2000);
    final allocation = summary.allocationBySymbol();
    expect(allocation['NVDA'], closeTo(0.5, 0.0001));
    expect(allocation['BTC'], closeTo(0.5, 0.0001));
  });

  test('handles an empty portfolio without dividing by zero', () {
    final summary = PortfolioCalculations.summarize([], {});
    expect(summary.totalValue, 0);
    expect(summary.totalPLPct, 0);
    expect(summary.allocationBySymbol(), isEmpty);
  });

  test('falls back to avgPrice when no live quote is available', () {
    final summary = PortfolioCalculations.summarize(
      [const PortfolioHolding(symbol: 'UNKNOWN', quantity: 5, avgPrice: 20)],
      {},
    );
    expect(summary.totalValue, 100);
    expect(summary.totalPL, 0);
  });
}
