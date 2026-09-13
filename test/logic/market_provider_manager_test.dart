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
  FakeProvider(this.id, {this.healthy = true, this.quoteResult, this.healthCheckDelay});

  @override
  final String id;
  bool healthy;
  MarketQuote? quoteResult;
  bool connected = false;
  int getQuoteCalls = 0;
  int healthCheckCalls = 0;
  Duration? healthCheckDelay;

  @override
  Future<bool> healthCheck() async {
    healthCheckCalls++;
    if (healthCheckDelay != null) await Future<void>.delayed(healthCheckDelay!);
    return healthy;
  }

  @override
  Future<void> connect() async => connected = true;

  @override
  Future<void> disconnect() async => connected = false;

  MarketQuote? Function(String symbol)? quoteResultFor;

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    getQuoteCalls++;
    return quoteResultFor != null ? quoteResultFor!(symbol) : quoteResult;
  }

  int getQuotesCalls = 0;

  @override
  Future<List<MarketQuote>> getQuotes(List<String> symbols) async {
    getQuotesCalls++;
    return symbols.map((s) => quoteResultFor != null ? quoteResultFor!(s) : quoteResult).whereType<MarketQuote>().toList();
  }

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
  test('getQuote auto-connects when called before an explicit connect() — no permanent race against startup', () async {
    // Regression test: a controller that calls getQuote() (via getAllQuotes)
    // immediately in its own constructor — every real controller does —
    // used to silently see activeProvider == null and get an empty result
    // forever, because connect() was fired-and-forgotten separately in
    // app.dart and nothing made later calls wait for it. Confirmed live
    // against the deployed backend before this fix existed.
    final primary = FakeProvider('twelveData', healthy: true, quoteResult: _quote('AAPL', 123));
    final manager = MarketProviderManager(primary: primary);

    final result = await manager.getQuote('AAPL');

    expect(result?.price, 123);
    expect(manager.mode, MarketDataMode.live);
  });

  test('concurrent unsupported-symbol failures collapse into one health check, not one per symbol', () async {
    // Regression test: getAllQuotes() fires every catalog symbol
    // concurrently via Future.wait. If several are unsupported/unmapped
    // (returning null) in the same instant, each used to independently
    // trigger its own healthCheck() call - confirmed live against the
    // deployed backend, where six real symbols rendered correctly on the
    // Markets screen at the same time the status chip read "PROVIDER
    // UNAVAILABLE", caused by exactly this concurrent-storm race.
    final primary = FakeProvider('twelveData', healthy: true, healthCheckDelay: const Duration(milliseconds: 30))
      ..quoteResultFor = (symbol) => symbol == 'SUPPORTED' ? _quote(symbol, 42) : null;
    final manager = MarketProviderManager(primary: primary);
    await manager.connect();
    primary.healthCheckCalls = 0; // reset the count from connect()'s own probe

    final results = await Future.wait([
      manager.getQuote('UNSUPPORTED_A'),
      manager.getQuote('UNSUPPORTED_B'),
      manager.getQuote('UNSUPPORTED_C'),
      manager.getQuote('SUPPORTED'),
    ]);

    expect(primary.healthCheckCalls, 1, reason: 'one shared health check, not one per failed symbol');
    expect(results, [null, null, null, _quote('SUPPORTED', 42)]);
    expect(manager.mode, MarketDataMode.live, reason: 'the single health check confirmed the provider is fine');
  });

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

  test('getQuotes delegates to the provider\'s own batch method once, never loops getQuote per symbol', () async {
    // Regression test: a whole-catalog load (~28 symbols) must be one
    // upstream call, not N - confirmed live against the deployed backend,
    // where N concurrent individual quote calls exhausted Twelve Data
    // Free's rate limit and every quote came back unavailable.
    final primary = FakeProvider('twelveData', healthy: true)..quoteResultFor = (s) => _quote(s, 1);
    final manager = MarketProviderManager(primary: primary);

    final results = await manager.getQuotes(['AAPL', 'MSFT', 'GOOGL']);

    expect(results, hasLength(3));
    expect(primary.getQuotesCalls, 1);
    expect(primary.getQuoteCalls, 0);
  });
}
