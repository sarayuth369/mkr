import 'package:flutter/foundation.dart';

import '../../../domain/market_quote.dart';
import '../../../domain/market_trend.dart';

@immutable
class GoldRadarData {
  const GoldRadarData({
    required this.gold,
    required this.dxy,
    required this.us10y,
    required this.oil,
    required this.trend,
    required this.momentumLabel,
    required this.volatilityLabel,
    required this.support,
    required this.resistance,
  });

  final MarketQuote gold;
  final MarketQuote? dxy;
  final MarketQuote? us10y;
  final MarketQuote? oil;
  final MarketTrend trend;
  final String momentumLabel;
  final String volatilityLabel;
  final double support;
  final double resistance;

  /// Purely derived from the current quote — deterministic, no external
  /// "technical analysis" claim, just a readable approximation for the UI.
  factory GoldRadarData.derive({
    required MarketQuote gold,
    MarketQuote? dxy,
    MarketQuote? us10y,
    MarketQuote? oil,
  }) {
    final trend = gold.changePct > 0.3
        ? MarketTrend.bullish
        : gold.changePct < -0.3
            ? MarketTrend.bearish
            : MarketTrend.neutral;
    final momentum = gold.changePct.abs() > 1.0
        ? 'Strong'
        : gold.changePct.abs() > 0.3
            ? 'Moderate'
            : 'Weak';
    final range = (gold.high ?? gold.price) - (gold.low ?? gold.price);
    final volatility = range / gold.price > 0.015
        ? 'Elevated'
        : range / gold.price > 0.006
            ? 'Normal'
            : 'Low';

    return GoldRadarData(
      gold: gold,
      dxy: dxy,
      us10y: us10y,
      oil: oil,
      trend: trend,
      momentumLabel: momentum,
      volatilityLabel: volatility,
      support: gold.price * 0.985,
      resistance: gold.price * 1.015,
    );
  }
}
