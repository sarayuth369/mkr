import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_session_status.dart';
import 'package:mkr/features/markets/data/market_catalog_repository.dart';
import 'package:mkr/features/markets/data/market_provider_manager.dart';
import 'package:mkr/features/markets/data/provider_backed_market_service.dart';
import 'package:mkr/features/markets/domain/market_data_provider.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

class _FakeCandleProvider implements MarketDataProvider {
  _FakeCandleProvider(this.history);

  final List<MarketCandle> history;
  final _tickController = StreamController<MarketCandle>.broadcast();

  void emit(MarketCandle candle) => _tickController.add(candle);

  @override
  String get id => 'fake';

  @override
  Future<bool> healthCheck() async => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<MarketQuote?> getQuote(String symbol) async => null;

  @override
  Future<MarketFetchResult> getQuotes(List<String> symbols) async => const MarketFetchEmpty();

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async => history;

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.open;

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) => const Stream.empty();

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) => _tickController.stream;
}

MarketCandle _candle(DateTime time, double price) =>
    MarketCandle(time: time, open: price, high: price, low: price, close: price);

void main() {
  test('ticks in the same timeframe bucket merge into the last candle instead of appending a new one', () async {
    final bucketStart = DateTime(2026, 1, 1, 10);
    final seed = [_candle(bucketStart, 100)];
    final provider = _FakeCandleProvider(seed);
    final manager = MarketProviderManager(primary: provider);
    final service = ProviderBackedMarketService(manager, MarketCatalogRepository(backendBaseUrl: 'https://unused.invalid'));

    final updates = <List<MarketCandle>>[];
    final sub = service.watchCandles('AAPL', Timeframe.h1).listen(updates.add);
    await Future<void>.delayed(Duration.zero);

    // Same hour bucket as the seed candle: must merge, not append.
    provider.emit(_candle(bucketStart.add(const Duration(minutes: 20)), 105));
    provider.emit(_candle(bucketStart.add(const Duration(minutes: 40)), 95));
    await Future<void>.delayed(Duration.zero);

    final latest = updates.last;
    expect(latest, hasLength(1), reason: 'same-bucket ticks must merge into one candle, not append');
    expect(latest.single.open, 100, reason: 'open stays the bucket-opening price');
    expect(latest.single.high, 105);
    expect(latest.single.low, 95);
    expect(latest.single.close, 95, reason: 'close tracks the latest tick');

    // A tick in the next hour bucket must start a new candle.
    provider.emit(_candle(bucketStart.add(const Duration(hours: 1, minutes: 5)), 110));
    await Future<void>.delayed(Duration.zero);

    expect(updates.last, hasLength(2), reason: 'a new bucket must append a fresh candle');
    expect(updates.last.last.open, 110);

    await sub.cancel();
  });

  test('Timeframe.label matches the spec\'s exact selector wording', () {
    expect(Timeframe.m1.label, '1m');
    expect(Timeframe.m5.label, '5m');
    expect(Timeframe.m15.label, '15m');
    expect(Timeframe.h1.label, '1H');
    expect(Timeframe.h4.label, '4H');
    expect(Timeframe.d1.label, '1D');
    expect(Timeframe.w1.label, '1W');
    expect(Timeframe.mo1.label, '1M');
  });
}
