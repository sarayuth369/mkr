import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_data_source.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_session_status.dart';
import 'package:mkr/features/markets/data/market_provider_manager.dart';
import 'package:mkr/features/markets/domain/market_data_provider.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';

MarketQuote _quote(String symbol, double price, {MarketDataSource source = MarketDataSource.twelveData}) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.usStock,
      price: price,
      changeAbs: 0,
      changePct: 0,
      source: source,
      isLive: true,
    );

/// A controllable fake so tests can simulate a genuinely unhealthy provider
/// vs. one that's merely quiet (e.g. market closed) without any networking.
class FakeProvider implements MarketDataProvider {
  FakeProvider(this.id, {this.healthy = true, this.quoteResult});

  @override
  final String id;
  bool healthy;
  MarketQuote? quoteResult;
  bool connected = false;
  int getQuoteCalls = 0;

  @override
  Future<bool> healthCheck() async => healthy;

  @override
  Future<void> connect() async => connected = true;

  @override
  Future<void> disconnect() async => connected = false;

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    getQuoteCalls++;
    return quoteResult;
  }

  @override
  Future<List<MarketQuote>> getQuotes(List<String> symbols) async =>
      symbols.map((s) => quoteResult).whereType<MarketQuote>().toList();

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async => const [];

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.open;

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) => const Stream.empty();

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) => const Stream.empty();
}

void main() {
  test('connects to a healthy primary and reports live', () async {
    final primary = FakeProvider('twelveData', healthy: true);
    final manager = MarketProviderManager(primary: primary);

    await manager.connect();

    expect(manager.mode, MarketDataMode.live);
    expect(manager.activeProvider, primary);
    expect(primary.connected, isTrue);
  });

  test('falls over to a healthy secondary when the primary is unhealthy and secondary is enabled', () async {
    final primary = FakeProvider('twelveData', healthy: false);
    final secondary = FakeProvider('alpaca', healthy: true);
    final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: true);

    await manager.connect();

    expect(manager.mode, MarketDataMode.live);
    expect(manager.activeProvider, secondary);
  });

  test('does not fail over to a disabled secondary even if it is healthy', () async {
    final primary = FakeProvider('twelveData', healthy: false);
    final secondary = FakeProvider('alpaca', healthy: true);
    final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: false);

    await manager.connect();

    expect(manager.mode, MarketDataMode.providerError);
    expect(manager.activeProvider, isNull);
  });

  test('reports providerError when both primary and secondary are unhealthy', () async {
    final primary = FakeProvider('twelveData', healthy: false);
    final secondary = FakeProvider('alpaca', healthy: false);
    final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: true);

    await manager.connect();

    expect(manager.mode, MarketDataMode.providerError);
  });

  test('an empty quote result from a still-healthy provider is NOT treated as failure (e.g. market closed)', () async {
    final primary = FakeProvider('twelveData', healthy: true, quoteResult: null);
    final secondary = FakeProvider('alpaca', healthy: true, quoteResult: _quote('AAPL', 1));
    final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: true);
    await manager.connect();

    final result = await manager.getQuote('AAPL');

    // Primary stayed healthy, so the manager must not silently swap to the
    // secondary just because one symbol came back empty this call.
    expect(result, isNull);
    expect(manager.activeProvider, primary);
    expect(manager.mode, MarketDataMode.live);
  });

  test('a genuinely unhealthy active provider triggers failover on the next call', () async {
    final primary = FakeProvider('twelveData', healthy: true, quoteResult: null);
    final secondary = FakeProvider('alpaca', healthy: true, quoteResult: _quote('AAPL', 42, source: MarketDataSource.alpaca));
    final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: true);
    await manager.connect();

    // Primary goes unhealthy between connect() and the next call.
    primary.healthy = false;
    final result = await manager.getQuote('AAPL');

    expect(result?.price, 42);
    expect(manager.activeProvider, secondary);
  });

  test('lastUpdated is set only after a successful quote', () async {
    final primary = FakeProvider('twelveData', healthy: true, quoteResult: _quote('AAPL', 1));
    final manager = MarketProviderManager(primary: primary);
    await manager.connect();
    expect(manager.lastUpdated, isNull);

    await manager.getQuote('AAPL');

    expect(manager.lastUpdated, isNotNull);
  });

  test('mode downgrades to stale once lastUpdated is older than the stale threshold', () async {
    final primary = FakeProvider('twelveData', healthy: true, quoteResult: _quote('AAPL', 1));
    final manager = MarketProviderManager(primary: primary, staleAfter: const Duration(milliseconds: 1));
    await manager.connect();
    await manager.getQuote('AAPL');

    await Future.delayed(const Duration(milliseconds: 10));

    expect(manager.mode, MarketDataMode.stale);
  });

  test('disconnect disconnects providers and reports offline', () async {
    final primary = FakeProvider('twelveData', healthy: true);
    final manager = MarketProviderManager(primary: primary);
    await manager.connect();

    await manager.disconnect();

    expect(primary.connected, isFalse);
    expect(manager.mode, MarketDataMode.offline);
    expect(manager.activeProvider, isNull);
  });
}
