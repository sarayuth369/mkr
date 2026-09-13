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

  /// Short label for the chart's timeframe selector chips.
  String get label => switch (this) {
        Timeframe.m1 => '1m',
        Timeframe.m5 => '5m',
        Timeframe.m15 => '15m',
        Timeframe.h1 => '1H',
        Timeframe.h4 => '4H',
        Timeframe.d1 => '1D',
        Timeframe.w1 => '1W',
        Timeframe.mo1 => '1M',
      };

  /// Approximate bucket width used only to aggregate live ticks into the
  /// currently-forming candle on the client (see [ProviderBackedMarketService]).
  /// The backend's own interval boundaries remain authoritative for
  /// historical candles fetched via REST — this is purely a display-layer
  /// approximation for the one candle still being built from live ticks, so
  /// `mo1`'s calendar-month imprecision (approximated as 30 days) never
  /// affects anything but that single in-progress candle.
  Duration get approxBucketDuration => switch (this) {
        Timeframe.m1 => const Duration(minutes: 1),
        Timeframe.m5 => const Duration(minutes: 5),
        Timeframe.m15 => const Duration(minutes: 15),
        Timeframe.h1 => const Duration(hours: 1),
        Timeframe.h4 => const Duration(hours: 4),
        Timeframe.d1 => const Duration(days: 1),
        Timeframe.w1 => const Duration(days: 7),
        Timeframe.mo1 => const Duration(days: 30),
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
