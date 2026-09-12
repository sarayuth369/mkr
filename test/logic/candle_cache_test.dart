import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/features/markets/data/candle_cache.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

MarketCandle _candle(double close) =>
    MarketCandle(time: DateTime(2026, 1, 1), open: close, high: close, low: close, close: close);

void main() {
  test('a second call within the TTL reuses the cached value without calling fetch again', () async {
    final cache = CandleCache(ttl: const Duration(minutes: 5));
    var callCount = 0;
    Future<List<MarketCandle>> fetch() async {
      callCount++;
      return [_candle(1.0)];
    }

    await cache.getOrFetch('AAPL', Timeframe.d1, fetch);
    await cache.getOrFetch('AAPL', Timeframe.d1, fetch);

    expect(callCount, 1);
  });

  test('concurrent calls for the same key de-duplicate into a single fetch', () async {
    var callCount = 0;
    final cache = CandleCache();
    Future<List<MarketCandle>> fetch() async {
      callCount++;
      await Future.delayed(const Duration(milliseconds: 20));
      return [_candle(2.0)];
    }

    final results = await Future.wait([
      cache.getOrFetch('AAPL', Timeframe.d1, fetch),
      cache.getOrFetch('AAPL', Timeframe.d1, fetch),
      cache.getOrFetch('AAPL', Timeframe.d1, fetch),
    ]);

    expect(callCount, 1);
    expect(results.every((r) => r.single.close == 2.0), isTrue);
  });

  test('a different symbol or timeframe is not deduplicated against another key', () async {
    var callCount = 0;
    final cache = CandleCache();
    Future<List<MarketCandle>> fetch() async {
      callCount++;
      return [_candle(3.0)];
    }

    await cache.getOrFetch('AAPL', Timeframe.d1, fetch);
    await cache.getOrFetch('AAPL', Timeframe.h1, fetch);
    await cache.getOrFetch('MSFT', Timeframe.d1, fetch);

    expect(callCount, 3);
  });

  test('an expired entry triggers a fresh fetch', () async {
    final cache = CandleCache(ttl: const Duration(milliseconds: 1));
    var callCount = 0;
    Future<List<MarketCandle>> fetch() async {
      callCount++;
      return [_candle(callCount.toDouble())];
    }

    await cache.getOrFetch('AAPL', Timeframe.d1, fetch);
    await Future.delayed(const Duration(milliseconds: 10));
    final second = await cache.getOrFetch('AAPL', Timeframe.d1, fetch);

    expect(callCount, 2);
    expect(second.single.close, 2.0);
  });
}
