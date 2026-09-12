/// Qualitative trend used by Gold Radar and Radar-type alerts. Never a
/// buy/sell instruction — purely descriptive of current market posture.
enum MarketTrend { bullish, neutral, bearish }

extension MarketTrendX on MarketTrend {
  String get label => switch (this) {
        MarketTrend.bullish => 'Bullish',
        MarketTrend.neutral => 'Neutral',
        MarketTrend.bearish => 'Bearish',
      };
}
