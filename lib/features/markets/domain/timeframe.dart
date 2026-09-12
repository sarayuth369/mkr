import '../../../core/widgets/price_chart.dart';

/// Candle interval requested from a real [MarketDataProvider]. Kept separate
/// from the UI-facing [ChartTimeframe] (1D/1W/1M/3M/1Y) so the UI's display
/// range and the provider's actual bar size can differ honestly instead of
/// forcing one enum to mean two things.
enum Timeframe { m1, m5, m15, h1, h4, d1, w1, mo1 }

extension TimeframeX on Timeframe {
  /// Twelve Data's `interval` query-param spelling for this timeframe.
  String get providerInterval => switch (this) {
        Timeframe.m1 => '1min',
        Timeframe.m5 => '5min',
        Timeframe.m15 => '15min',
        Timeframe.h1 => '1h',
        Timeframe.h4 => '4h',
        Timeframe.d1 => '1day',
        Timeframe.w1 => '1week',
        Timeframe.mo1 => '1month',
      };
}

/// Maps the UI's display-range control to an honest underlying bar size.
/// A shorter display range gets intraday bars; a longer one gets daily/
/// weekly bars — never fabricated data to "fill" a range Twelve Data Free
/// doesn't actually provide at finer granularity.
Timeframe timeframeForChartRange(ChartTimeframe range) => switch (range) {
      ChartTimeframe.d1 => Timeframe.h1,
      ChartTimeframe.w1 => Timeframe.h1,
      ChartTimeframe.m1 => Timeframe.d1,
      ChartTimeframe.m3 => Timeframe.d1,
      ChartTimeframe.y1 => Timeframe.w1,
    };
