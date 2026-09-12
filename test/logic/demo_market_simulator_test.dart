import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/features/markets/data/demo_market_simulator.dart';

void main() {
  const seedQuote = MarketQuote(
    symbol: 'TEST',
    name: 'Test Asset',
    assetClass: AssetClass.usStock,
    price: 100,
    changeAbs: 0,
    changePct: 0,
  );

  test('price changes over repeated ticks (not static)', () {
    final sim = DemoMarketSimulator(seed: [seedQuote], random: Random(1));
    final prices = <double>{};
    for (var i = 0; i < 50; i++) {
      sim.tickAll();
      prices.add(sim.currentQuote('TEST')!.price);
    }
    expect(prices.length, greaterThan(1), reason: 'price should move across many ticks, not stay static');
  });

  test('price never becomes negative or zero, even over a long session', () {
    final sim = DemoMarketSimulator(seed: [seedQuote], random: Random(2));
    for (var i = 0; i < 5000; i++) {
      sim.tickAll();
      expect(sim.currentQuote('TEST')!.price, greaterThan(0));
    }
  });

  test('every candle satisfies OHLC invariants across many ticks', () {
    final sim = DemoMarketSimulator(
      seed: [seedQuote],
      random: Random(3),
      candleDuration: const Duration(milliseconds: 1),
    );
    var now = DateTime(2026, 1, 1);
    for (var i = 0; i < 500; i++) {
      now = now.add(const Duration(milliseconds: 1));
      sim.tickAll(now: now);
    }
    final candles = sim.currentCandles('TEST');
    expect(candles, isNotEmpty);
    for (final candle in candles) {
      expect(candle.high, greaterThanOrEqualTo(candle.open));
      expect(candle.high, greaterThanOrEqualTo(candle.close));
      expect(candle.low, lessThanOrEqualTo(candle.open));
      expect(candle.low, lessThanOrEqualTo(candle.close));
      expect(candle.high, greaterThanOrEqualTo(candle.low));
    }
  });

  test('a candle closes into history once its interval elapses and a new one starts', () {
    final sim = DemoMarketSimulator(
      seed: [seedQuote],
      random: Random(4),
      candleDuration: const Duration(seconds: 10),
    );
    final t0 = DateTime(2026, 1, 1, 0, 0, 0);
    sim.tickAll(now: t0);
    expect(sim.currentCandles('TEST').length, 1, reason: 'first tick opens the first (still-forming) candle');

    sim.tickAll(now: t0.add(const Duration(seconds: 5)));
    expect(sim.currentCandles('TEST').length, 1, reason: 'still within the same candle interval');

    sim.tickAll(now: t0.add(const Duration(seconds: 11)));
    expect(sim.currentCandles('TEST').length, 2, reason: 'interval elapsed — previous candle closed, new one opened');
  });

  test('bounded history never grows without limit', () {
    final sim = DemoMarketSimulator(
      seed: [seedQuote],
      random: Random(5),
      candleDuration: const Duration(milliseconds: 1),
    );
    var now = DateTime(2026, 1, 1);
    for (var i = 0; i < DemoMarketSimulator.maxHistoryPerSymbol * 3; i++) {
      now = now.add(const Duration(milliseconds: 1));
      sim.tickAll(now: now);
    }
    expect(sim.currentCandles('TEST').length, lessThanOrEqualTo(DemoMarketSimulator.maxHistoryPerSymbol + 1));
  });
}
