import 'package:flutter/foundation.dart';

import 'asset_class.dart';

/// A single asset's current market data. One shape reused across Home,
/// Markets, Market Detail, Gold Radar, Watchlist and Portfolio so there is
/// exactly one "quote" concept in the app.
@immutable
class MarketQuote {
  const MarketQuote({
    required this.symbol,
    required this.name,
    required this.assetClass,
    required this.price,
    required this.changeAbs,
    required this.changePct,
    this.high,
    this.low,
    this.open,
    this.prevClose,
    this.volume,
    this.week52High,
    this.week52Low,
    this.currency = 'USD',
  });

  final String symbol;
  final String name;
  final AssetClass assetClass;
  final double price;
  final double changeAbs;
  final double changePct;
  final double? high;
  final double? low;
  final double? open;
  final double? prevClose;
  final double? volume;

  /// 52-week high/low — only populated for a handful of featured symbols in
  /// the mock catalog; `null` elsewhere, in which case the UI simply omits
  /// the row rather than showing a fabricated range.
  final double? week52High;
  final double? week52Low;
  final String currency;

  bool get isUp => changePct >= 0;

  MarketQuote copyWith({
    double? price,
    double? changeAbs,
    double? changePct,
  }) {
    return MarketQuote(
      symbol: symbol,
      name: name,
      assetClass: assetClass,
      price: price ?? this.price,
      changeAbs: changeAbs ?? this.changeAbs,
      changePct: changePct ?? this.changePct,
      high: high,
      low: low,
      open: open,
      prevClose: prevClose,
      volume: volume,
      week52High: week52High,
      week52Low: week52Low,
      currency: currency,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MarketQuote &&
          runtimeType == other.runtimeType &&
          symbol == other.symbol &&
          price == other.price &&
          changeAbs == other.changeAbs &&
          changePct == other.changePct;

  @override
  int get hashCode => Object.hash(symbol, price, changeAbs, changePct);
}
