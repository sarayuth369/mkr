import 'dart:async';

import '../../../domain/market_candle.dart';
import '../domain/timeframe.dart';

/// TTL cache + in-flight request de-duplication for historical candle
/// fetches, shared across every screen. Twelve Data Free has tight rate
/// limits — without this, Home/Markets/Watchlist/Detail asking for the same
/// symbol within a few seconds of each other would each fire their own REST
/// call. With it, only the first caller actually hits the network; the rest
/// receive its result (in flight) or the cached one (already settled).
class CandleCache {
  CandleCache({Duration? ttl}) : _ttl = ttl ?? const Duration(seconds: 30);

  final Duration _ttl;
  final Map<String, _Entry> _entries = {};
  final Map<String, Future<List<MarketCandle>>> _inFlight = {};

  String _key(String symbol, Timeframe timeframe) => '$symbol|${timeframe.name}';

  /// Returns the cached value for [symbol]/[timeframe] if still fresh,
  /// otherwise calls [fetch] — de-duplicating concurrent calls for the same
  /// key so only one actually reaches the network.
  Future<List<MarketCandle>> getOrFetch(
    String symbol,
    Timeframe timeframe,
    Future<List<MarketCandle>> Function() fetch,
  ) {
    final key = _key(symbol, timeframe);
    final cached = _entries[key];
    if (cached != null && DateTime.now().difference(cached.storedAt) < _ttl) {
      return Future.value(cached.candles);
    }

    final pending = _inFlight[key];
    if (pending != null) return pending;

    final future = fetch().then((candles) {
      _entries[key] = _Entry(candles, DateTime.now());
      _inFlight.remove(key);
      return candles;
    }, onError: (Object e, StackTrace st) {
      _inFlight.remove(key);
      throw e;
    });
    _inFlight[key] = future;
    return future;
  }

  void invalidate(String symbol, Timeframe timeframe) => _entries.remove(_key(symbol, timeframe));

  void clear() {
    _entries.clear();
    _inFlight.clear();
  }
}

class _Entry {
  _Entry(this.candles, this.storedAt);
  final List<MarketCandle> candles;
  final DateTime storedAt;
}
