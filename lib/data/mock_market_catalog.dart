import 'dart:math';

import '../domain/asset_class.dart';
import '../domain/market_quote.dart';

/// Single source of truth for every mock symbol in the app. Home, Markets,
/// Watchlist search, Alerts and Portfolio all resolve symbols against this
/// catalog instead of each maintaining their own list.
class MockMarketCatalog {
  MockMarketCatalog._();

  static final List<MarketQuote> all = [
    // Gold & related
    const MarketQuote(
      symbol: 'XAU/USD',
      name: 'Gold Spot',
      assetClass: AssetClass.gold,
      price: 3412.80,
      changeAbs: 18.40,
      changePct: 0.54,
      high: 3421.10,
      low: 3388.20,
      open: 3394.40,
      prevClose: 3394.40,
    ),
    const MarketQuote(
      symbol: 'DXY',
      name: 'US Dollar Index',
      assetClass: AssetClass.commodity,
      price: 101.24,
      changeAbs: -0.18,
      changePct: -0.18,
    ),
    const MarketQuote(
      symbol: 'US10Y',
      name: 'US 10-Year Treasury Yield',
      assetClass: AssetClass.rate,
      price: 4.28,
      changeAbs: 0.03,
      changePct: 0.71,
    ),
    const MarketQuote(
      symbol: 'OIL',
      name: 'WTI Crude Oil',
      assetClass: AssetClass.commodity,
      price: 71.55,
      changeAbs: -0.62,
      changePct: -0.86,
    ),
    // US Stocks
    const MarketQuote(
      symbol: 'NVDA',
      name: 'NVIDIA Corp',
      assetClass: AssetClass.usStock,
      price: 187.62,
      changeAbs: 3.14,
      changePct: 1.70,
      high: 189.20,
      low: 183.10,
      open: 184.50,
      prevClose: 184.48,
      volume: 245800000,
    ),
    const MarketQuote(
      symbol: 'AAPL',
      name: 'Apple Inc',
      assetClass: AssetClass.usStock,
      price: 231.40,
      changeAbs: -1.05,
      changePct: -0.45,
      volume: 52300000,
    ),
    const MarketQuote(
      symbol: 'MSFT',
      name: 'Microsoft Corp',
      assetClass: AssetClass.usStock,
      price: 428.90,
      changeAbs: 2.30,
      changePct: 0.54,
      volume: 19800000,
    ),
    const MarketQuote(
      symbol: 'AMZN',
      name: 'Amazon.com Inc',
      assetClass: AssetClass.usStock,
      price: 198.75,
      changeAbs: 1.12,
      changePct: 0.57,
      volume: 31200000,
    ),
    const MarketQuote(
      symbol: 'META',
      name: 'Meta Platforms Inc',
      assetClass: AssetClass.usStock,
      price: 612.30,
      changeAbs: -4.80,
      changePct: -0.78,
      volume: 12100000,
    ),
    const MarketQuote(
      symbol: 'GOOGL',
      name: 'Alphabet Inc',
      assetClass: AssetClass.usStock,
      price: 176.20,
      changeAbs: 0.95,
      changePct: 0.54,
      volume: 22400000,
    ),
    const MarketQuote(
      symbol: 'TSLA',
      name: 'Tesla Inc',
      assetClass: AssetClass.usStock,
      price: 248.60,
      changeAbs: 6.70,
      changePct: 2.77,
      volume: 88900000,
    ),
    const MarketQuote(
      symbol: 'QQQ',
      name: 'Invesco QQQ Trust',
      assetClass: AssetClass.usStock,
      price: 512.40,
      changeAbs: 2.10,
      changePct: 0.41,
      volume: 41200000,
    ),
    // Indices
    const MarketQuote(
      symbol: 'SPX',
      name: 'S&P 500',
      assetClass: AssetClass.indices,
      price: 5872.30,
      changeAbs: 12.40,
      changePct: 0.21,
    ),
    const MarketQuote(
      symbol: 'NDX',
      name: 'Nasdaq Composite',
      assetClass: AssetClass.indices,
      price: 18631.90,
      changeAbs: -22.10,
      changePct: -0.12,
    ),
    const MarketQuote(
      symbol: 'DJI',
      name: 'Dow Jones Industrial Average',
      assetClass: AssetClass.indices,
      price: 43120.50,
      changeAbs: 88.20,
      changePct: 0.20,
    ),
    const MarketQuote(
      symbol: 'RUT',
      name: 'Russell 2000',
      assetClass: AssetClass.indices,
      price: 2245.80,
      changeAbs: -6.30,
      changePct: -0.28,
    ),
    const MarketQuote(
      symbol: 'VIX',
      name: 'CBOE Volatility Index',
      assetClass: AssetClass.indices,
      price: 14.82,
      changeAbs: 0.44,
      changePct: 3.06,
    ),
    // Crypto
    const MarketQuote(
      symbol: 'BTC',
      name: 'Bitcoin',
      assetClass: AssetClass.crypto,
      price: 96420.00,
      changeAbs: 1840.00,
      changePct: 1.94,
      high: 97100.00,
      low: 94200.00,
      open: 94580.00,
      prevClose: 94580.00,
    ),
    const MarketQuote(
      symbol: 'ETH',
      name: 'Ethereum',
      assetClass: AssetClass.crypto,
      price: 3384.20,
      changeAbs: -42.10,
      changePct: -1.23,
    ),
    const MarketQuote(
      symbol: 'SOL',
      name: 'Solana',
      assetClass: AssetClass.crypto,
      price: 198.40,
      changeAbs: 8.90,
      changePct: 4.70,
    ),
    const MarketQuote(
      symbol: 'XRP',
      name: 'Ripple',
      assetClass: AssetClass.crypto,
      price: 2.14,
      changeAbs: 0.06,
      changePct: 2.88,
    ),
    // Forex
    const MarketQuote(
      symbol: 'EUR/USD',
      name: 'Euro / US Dollar',
      assetClass: AssetClass.forex,
      price: 1.0842,
      changeAbs: 0.0021,
      changePct: 0.19,
    ),
    const MarketQuote(
      symbol: 'GBP/USD',
      name: 'British Pound / US Dollar',
      assetClass: AssetClass.forex,
      price: 1.2681,
      changeAbs: -0.0034,
      changePct: -0.27,
    ),
    const MarketQuote(
      symbol: 'USD/JPY',
      name: 'US Dollar / Japanese Yen',
      assetClass: AssetClass.forex,
      price: 152.34,
      changeAbs: 0.48,
      changePct: 0.32,
    ),
    const MarketQuote(
      symbol: 'AUD/USD',
      name: 'Australian Dollar / US Dollar',
      assetClass: AssetClass.forex,
      price: 0.6412,
      changeAbs: 0.0018,
      changePct: 0.28,
    ),
    const MarketQuote(
      symbol: 'USD/CAD',
      name: 'US Dollar / Canadian Dollar',
      assetClass: AssetClass.forex,
      price: 1.4025,
      changeAbs: -0.0022,
      changePct: -0.16,
    ),
    // Thailand
    const MarketQuote(
      symbol: 'SET',
      name: 'SET Index',
      assetClass: AssetClass.thailand,
      price: 1382.40,
      changeAbs: -4.20,
      changePct: -0.30,
      currency: 'THB',
    ),
    const MarketQuote(
      symbol: 'SET50',
      name: 'SET50 Index',
      assetClass: AssetClass.thailand,
      price: 872.15,
      changeAbs: -1.85,
      changePct: -0.21,
      currency: 'THB',
    ),
  ];

  static MarketQuote? bySymbol(String symbol) {
    for (final quote in all) {
      if (quote.symbol == symbol) return quote;
    }
    return null;
  }

  static List<MarketQuote> byAssetClass(AssetClass assetClass) =>
      all.where((q) => q.assetClass == assetClass).toList();

  static List<MarketQuote> search(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return all;
    return all
        .where((quote) =>
            quote.symbol.toLowerCase().contains(q) ||
            quote.name.toLowerCase().contains(q))
        .toList();
  }

  /// Deterministic synthetic price history for [PriceChart]. Not real data —
  /// generated from the symbol's current price with a seeded, repeatable
  /// wobble so the same symbol/timeframe always renders the same curve.
  static List<double> syntheticSeries(String symbol, {int points = 30}) {
    final seed = symbol.codeUnits.fold<int>(0, (a, b) => a + b);
    final random = Random(seed);
    final quote = bySymbol(symbol);
    final base = quote?.price ?? 100.0;
    var value = base * 0.97;
    final series = <double>[];
    for (var i = 0; i < points; i++) {
      value += (random.nextDouble() - 0.48) * base * 0.006;
      series.add(value);
    }
    series[series.length - 1] = base;
    return series;
  }
}
