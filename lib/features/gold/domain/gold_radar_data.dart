import 'package:flutter/foundation.dart';

import '../../../domain/market_quote.dart';
import '../../../domain/market_trend.dart';

enum MomentumLevel { strong, moderate, weak }

enum VolatilityLevel { elevated, normal, low }

@immutable
class GoldRadarData {
  const GoldRadarData({
    required this.gold,
    required this.dxy,
    required this.us10y,
    required this.oil,
    required this.trend,
    required this.momentum,
    required this.volatility,
    required this.support,
    required this.resistance,
  });

  final MarketQuote gold;
  final MarketQuote? dxy;
  final MarketQuote? us10y;
  final MarketQuote? oil;
  final MarketTrend trend;
  final MomentumLevel momentum;
  final VolatilityLevel volatility;
  final double support;
  final double resistance;

  /// Purely derived from the current quote — deterministic, no external
  /// "technical analysis" claim, just a readable approximation for the UI.
  /// Returns enums (not display strings) so the presentation layer is the
  /// only place that maps a value to localized text.
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
        ? MomentumLevel.strong
        : gold.changePct.abs() > 0.3
            ? MomentumLevel.moderate
            : MomentumLevel.weak;
    final range = (gold.high ?? gold.price) - (gold.low ?? gold.price);
    final volatility = range / gold.price > 0.015
        ? VolatilityLevel.elevated
        : range / gold.price > 0.006
            ? VolatilityLevel.normal
            : VolatilityLevel.low;

    return GoldRadarData(
      gold: gold,
      dxy: dxy,
      us10y: us10y,
      oil: oil,
      trend: trend,
      momentum: momentum,
      volatility: volatility,
      support: gold.price * 0.985,
      resistance: gold.price * 1.015,
    );
  }
}
