import 'dart:math';

import '../../../domain/asset_class.dart';
import '../../../domain/market_candle.dart';
import '../../../domain/market_quote.dart';

/// Per-symbol movement profile — different assets should not all jitter the
/// same amount. Values are max percent-move-per-tick magnitudes.
class AssetVolatilityProfile {
  const AssetVolatilityProfile({required this.tickVolatilityPct, this.reversion = 0.02});

  /// Roughly the max absolute % a single tick can move the price.
  final double tickVolatilityPct;

  /// How strongly price is pulled back toward its session anchor each tick
  /// (0..1) — keeps a long demo session from drifting into an unrealistic
  /// price over time while still allowing visible short-term movement.
  final double reversion;
}

/// A controlled random walk + OHLC candle builder, reusable and fully
/// testable without any Flutter/async dependency. [MockMarketService] drives
/// this on a timer and exposes the results via the normal [MarketService]
/// streams — the UI never talks to this class directly, and a real
/// Cloudflare-Worker-backed implementation can replace it without any UI
/// change.
class DemoMarketSimulator {
  DemoMarketSimulator({required List<MarketQuote> seed, Random? random, Duration? candleDuration})
      : _random = random ?? Random(),
        _candleDuration = candleDuration ?? const Duration(seconds: 20) {
    for (final quote in seed) {
      _anchors[quote.symbol] = quote.price;
      _current[quote.symbol] = quote;
    }
  }

  static const int maxHistoryPerSymbol = 120;

  final Random _random;
  final Duration _candleDuration;

  final Map<String, double> _anchors = {};
  final Map<String, MarketQuote> _current = {};
  final Map<String, MarketCandle> _forming = {};
  final Map<String, List<MarketCandle>> _history = {};
  final Map<String, DateTime> _candleStartedAt = {};

  static const Map<String, AssetVolatilityProfile> _profilesBySymbol = {
    'XAU/USD': AssetVolatilityProfile(tickVolatilityPct: 0.035),
    'BTC': AssetVolatilityProfile(tickVolatilityPct: 0.18, reversion: 0.015),
    'ETH': AssetVolatilityProfile(tickVolatilityPct: 0.20, reversion: 0.015),
    'SOL': AssetVolatilityProfile(tickVolatilityPct: 0.24, reversion: 0.015),
    'XRP': AssetVolatilityProfile(tickVolatilityPct: 0.22, reversion: 0.015),
    'NVDA': AssetVolatilityProfile(tickVolatilityPct: 0.09),
    'TSLA': AssetVolatilityProfile(tickVolatilityPct: 0.10),
    'VIX': AssetVolatilityProfile(tickVolatilityPct: 0.12),
  };

  static const Map<AssetClass, AssetVolatilityProfile> _profilesByClass = {
    AssetClass.gold: AssetVolatilityProfile(tickVolatilityPct: 0.035),
    AssetClass.usStock: AssetVolatilityProfile(tickVolatilityPct: 0.06),
    AssetClass.indices: AssetVolatilityProfile(tickVolatilityPct: 0.045),
    AssetClass.crypto: AssetVolatilityProfile(tickVolatilityPct: 0.18, reversion: 0.015),
    AssetClass.forex: AssetVolatilityProfile(tickVolatilityPct: 0.02),
    AssetClass.thailand: AssetVolatilityProfile(tickVolatilityPct: 0.03),
    AssetClass.commodity: AssetVolatilityProfile(tickVolatilityPct: 0.04),
    AssetClass.rate: AssetVolatilityProfile(tickVolatilityPct: 0.015),
  };

  AssetVolatilityProfile _profileFor(MarketQuote quote) =>
      _profilesBySymbol[quote.symbol] ?? _profilesByClass[quote.assetClass] ?? const AssetVolatilityProfile(tickVolatilityPct: 0.05);

  MarketQuote? currentQuote(String symbol) => _current[symbol];

  /// Bounded candle history plus the still-forming current candle appended
  /// last, oldest first.
  List<MarketCandle> currentCandles(String symbol) {
    final history = _history[symbol] ?? const <MarketCandle>[];
    final forming = _forming[symbol];
    return forming == null ? history : [...history, forming];
  }

  /// Advance every seeded symbol by exactly one tick. Returns the symbols
  /// whose quote actually changed (all of them, in practice) so callers can
  /// notify listeners.
  List<MarketQuote> tickAll({DateTime? now}) {
    final timestamp = now ?? DateTime.now();
    final updated = <MarketQuote>[];
    for (final symbol in _current.keys) {
      final quote = _tickSymbol(symbol, timestamp);
      if (quote != null) updated.add(quote);
    }
    return updated;
  }

  MarketQuote? _tickSymbol(String symbol, DateTime timestamp) {
    final base = _current[symbol];
    final anchor = _anchors[symbol];
    if (base == null || anchor == null) return null;

    final profile = _profileFor(base);
    final noisePct = (_random.nextDouble() * 2 - 1) * profile.tickVolatilityPct;
    var newPrice = base.price * (1 + noisePct / 100);
    // Gentle pull back toward the session anchor so a long-running demo
    // never drifts into an unrealistic price — still lets short-term moves
    // show clearly.
    newPrice += (anchor - newPrice) * profile.reversion;
    if (newPrice < 0.0001) newPrice = 0.0001; // price can never go negative/zero

    final changeAbs = newPrice - anchor;
    final changePct = anchor == 0 ? 0.0 : (changeAbs / anchor) * 100;

    final updatedQuote = base.copyWith(price: newPrice, changeAbs: changeAbs, changePct: changePct);
    _current[symbol] = updatedQuote;
    _updateCandle(symbol, newPrice, timestamp);
    return updatedQuote;
  }

  void _updateCandle(String symbol, double price, DateTime timestamp) {
    final forming = _forming[symbol];
    final startedAt = _candleStartedAt[symbol];

    if (forming == null || startedAt == null || timestamp.difference(startedAt) >= _candleDuration) {
      // Close the previous candle (if any) into history, start a new one.
      if (forming != null) {
        final history = _history.putIfAbsent(symbol, () => []);
        history.add(forming);
        if (history.length > maxHistoryPerSymbol) {
          history.removeAt(0);
        }
      }
      _candleStartedAt[symbol] = timestamp;
      _forming[symbol] = MarketCandle(time: timestamp, open: price, high: price, low: price, close: price);
      return;
    }

    _forming[symbol] = forming.copyWith(
      high: price > forming.high ? price : forming.high,
      low: price < forming.low ? price : forming.low,
      close: price,
    );
  }
}
