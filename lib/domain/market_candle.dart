import 'package:flutter/foundation.dart';

/// One OHLC candle. Used by the candlestick chart; built incrementally by
/// [DemoMarketSimulator]-style tick engines (mock today, a real backend
/// stream later) behind the [MarketService] abstraction — the UI never
/// builds candles itself.
@immutable
class MarketCandle {
  const MarketCandle({
    required this.time,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
  });

  final DateTime time;
  final double open;
  final double high;
  final double low;
  final double close;

  bool get isBullish => close >= open;

  MarketCandle copyWith({double? high, double? low, double? close}) {
    return MarketCandle(
      time: time,
      open: open,
      high: high ?? this.high,
      low: low ?? this.low,
      close: close ?? this.close,
    );
  }
}
