import 'package:flutter/foundation.dart';

import 'asset_class.dart';
import 'market_data_source.dart';
import 'market_session_status.dart';

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
    this.bid,
    this.ask,
    this.source = MarketDataSource.demo,
    this.isLive = false,
    this.sessionStatus,
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

  /// Best bid/ask, when the provider supplies one. `null` when unavailable
  /// (e.g. the demo simulator, or a provider that only returns a last
  /// trade price) — never fabricated as a spread around [price].
  final double? bid;
  final double? ask;

  /// Which [MarketDataProvider] this quote actually came from.
  final MarketDataSource source;

  /// True only when this quote is a genuine real-time tick from [source];
  /// the demo simulator and any stale/cached real quote report `false`.
  final bool isLive;

  /// The exchange's trading session at the time of this quote, if the
  /// provider reports one. `null` when unknown (e.g. demo mode).
  final MarketSessionStatus? sessionStatus;

  bool get isUp => changePct >= 0;

  MarketQuote copyWith({
    double? price,
    double? changeAbs,
    double? changePct,
    double? bid,
    double? ask,
    MarketDataSource? source,
    bool? isLive,
    MarketSessionStatus? sessionStatus,
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
      bid: bid ?? this.bid,
      ask: ask ?? this.ask,
      source: source ?? this.source,
      isLive: isLive ?? this.isLive,
      sessionStatus: sessionStatus ?? this.sessionStatus,
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
