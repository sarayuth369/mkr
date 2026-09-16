import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_data_source.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_session_status.dart';
import 'package:mkr/features/markets/data/market_provider_manager.dart';
import 'package:mkr/features/markets/domain/market_data_provider.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
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

  /// Thrown by [getQuote] when set - simulates a real fetch fault (HTTP
  /// non-200, malformed response, connection failure) instead of "no data".
  MarketFetchException? quoteException;

  /// Overrides [getQuotes]' derived result entirely when set - simulates a
  /// provider-error/offline/partial batch outcome directly.
  MarketFetchResult? quotesResult;

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
    if (quoteException != null) throw quoteException!;
    return quoteResultFor != null ? quoteResultFor!(symbol) : quoteResult;
  }

  int getQuotesCalls = 0;

  @override
  Future<MarketFetchResult> getQuotes(List<String> symbols) async {
    getQuotesCalls++;
    if (quotesResult != null) return quotesResult!;
    final quotes = symbols.map((s) => quoteResultFor != null ? quoteResultFor!(s) : quoteResult).whereType<MarketQuote>().toList();
    return quotes.isEmpty ? const MarketFetchEmpty() : MarketFetchSuccess(quotes);
  }

  /// Overrides the returned candle list when set.
  List<MarketCandle>? candlesResult;

  /// Thrown by [getHistoricalCandles] when set - simulates a real fetch
  /// fault (HTTP non-200, malformed response, connection failure), same
  /// convention as [quoteException] (2026-09-15 FINAL FINAL correction
  /// task, Defect 3).
  MarketFetchException? candlesException;
  int getHistoricalCandlesCalls = 0;

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async {
    getHistoricalCandlesCalls++;
    if (candlesException != null) throw candlesException!;
    return candlesResult ?? const [];
  }

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.open;

  /// Controllable per-symbol tick source so tests can push ticks and
  /// observe exactly which symbols are currently subscribed/released -
  /// 2026-09-15 post-audit task (Finding 2).
  final _tickController = StreamController<MarketQuote>.broadcast();
  int watchQuotesCalls = 0;
  List<String>? lastWatchQuotesSymbols;

  void emitTick(MarketQuote quote) => _tickController.add(quote);

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    watchQuotesCalls++;
    lastWatchQuotesSymbols = symbols;
    return _tickController.stream.where((q) => symbols.contains(q.symbol));
  }

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) => const Stream.empty();

  /// Every symbol ever passed to [unsubscribeQuotes], in call order -
  /// 2026-09-15 post-audit task (Finding 2): previously nothing in
  /// [MarketProviderManager] ever called this at all.
  final List<String> unsubscribedSymbols = [];
  int unsubscribeQuotesCalls = 0;

  @override
  void unsubscribeQuotes(List<String> symbols) {
    unsubscribeQuotesCalls++;
    unsubscribedSymbols.addAll(symbols);
  }
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

    final result = await manager.getQuotes(['AAPL', 'MSFT', 'GOOGL']);

    expect(result.quotes, hasLength(3));
    expect(primary.getQuotesCalls, 1);
    expect(primary.getQuoteCalls, 0);
  });

  group('2026-09-15 frontend hardening — typed MarketFetchResult', () {
    test('a provider failure never collapses into an empty result - returns MarketFetchFailure', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..quotesResult = const MarketFetchFailure(MarketFetchFailureKind.providerError, 'HTTP 500');
      final manager = MarketProviderManager(primary: primary);

      final result = await manager.getQuotes(['AAPL', 'MSFT']);

      expect(result, isA<MarketFetchFailure>());
      expect((result as MarketFetchFailure).message, 'HTTP 500');
    });

    test('a partial batch (valid items + errors) preserves both - quotes stay visible, failed symbols are listed', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..quotesResult = MarketFetchPartial([_quote('AAPL', 100)], ['MSFT']);
      final manager = MarketProviderManager(primary: primary);

      final result = await manager.getQuotes(['AAPL', 'MSFT']);

      expect(result, isA<MarketFetchPartial>());
      final partial = result as MarketFetchPartial;
      expect(partial.quotes.single.symbol, 'AAPL');
      expect(partial.failedSymbols, ['MSFT']);
    });

    test('a valid zero-item response with no error is a genuine MarketFetchEmpty, not a failure', () async {
      final primary = FakeProvider('twelveData', healthy: true)..quotesResult = const MarketFetchEmpty();
      final manager = MarketProviderManager(primary: primary);

      final result = await manager.getQuotes(['NOSUCHSYMBOL']);

      expect(result, isA<MarketFetchEmpty>());
    });

    test('lastUpdated does not advance after a failed or empty fetch', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..quotesResult = const MarketFetchFailure(MarketFetchFailureKind.providerError, 'boom');
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      await manager.getQuotes(['AAPL']);

      expect(manager.lastUpdated, isNull);
    });

    test('LIVE (mode) becomes true only via a successful connect, and lastUpdated only after real quote data', () async {
      final primary = FakeProvider('twelveData', healthy: true)..quotesResult = MarketFetchSuccess([_quote('AAPL', 1)]);
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();
      expect(manager.mode, MarketDataMode.live);
      expect(manager.lastUpdated, isNull); // connected, but no data fetched yet

      await manager.getQuotes(['AAPL']);

      expect(manager.lastUpdated, isNotNull);
    });

    test('a thrown MarketFetchException from getQuote surfaces to the caller once there is no fallback, never a silent null', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..quoteException = const MarketFetchException(MarketFetchFailureKind.providerError, 'rate limited');
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      await expectLater(manager.getQuote('AAPL'), throwsA(isA<MarketFetchException>()));
    });

    test('concurrent identical getQuotes calls coalesce into one provider call (client-side single-flight)', () async {
      final primary = FakeProvider('twelveData', healthy: true)..quoteResultFor = (s) => _quote(s, 1);
      final manager = MarketProviderManager(primary: primary);

      final results = await Future.wait([
        manager.getQuotes(['AAPL', 'MSFT']),
        manager.getQuotes(['MSFT', 'AAPL']), // same set, different order - still the same request
      ]);

      expect(primary.getQuotesCalls, 1);
      expect(results[0].quotes, hasLength(2));
      expect(results[1].quotes, hasLength(2));
    });

    test('different symbol sets requested concurrently are NOT coalesced', () async {
      final primary = FakeProvider('twelveData', healthy: true)..quoteResultFor = (s) => _quote(s, 1);
      final manager = MarketProviderManager(primary: primary);

      await Future.wait([
        manager.getQuotes(['AAPL']),
        manager.getQuotes(['MSFT']),
      ]);

      expect(primary.getQuotesCalls, 2);
    });
  });

  group('2026-09-15 FINAL FINAL correction task — getHistoricalCandles failure semantics (Defect 3)', () {
    test('no active provider at all throws, never silently returns []', () async {
      final primary = FakeProvider('twelveData', healthy: false);
      final manager = MarketProviderManager(primary: primary);

      await expectLater(
        manager.getHistoricalCandles('AAPL', Timeframe.h1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('a thrown MarketFetchException from the provider surfaces once there is no fallback, never a silent []', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..candlesException = const MarketFetchException(MarketFetchFailureKind.providerError, 'HTTP 500');
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      await expectLater(
        manager.getHistoricalCandles('AAPL', Timeframe.h1),
        throwsA(isA<MarketFetchException>()),
      );
    });

    test('a genuinely empty candle list from a still-healthy provider is NOT treated as a failure', () async {
      final primary = FakeProvider('twelveData', healthy: true)..candlesResult = const [];
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      final result = await manager.getHistoricalCandles('AAPL', Timeframe.h1);

      expect(result, isEmpty);
      expect(manager.activeProvider, primary); // stayed healthy - no failover just because history was empty
    });

    // 2026-09-15 pre-Closed-Testing audit (Known Issue D): a genuinely
    // empty history (the provider call returned normally, no exception)
    // must not trigger a confirmatory health check at all - there is
    // nothing to confirm, the provider already answered successfully with
    // "nothing here". Calling _handleFailure anyway was pure downside: an
    // UNRELATED health-check blip at that exact moment could spuriously
    // flip the whole manager to providerError over a symbol that was never
    // actually a failure.
    test('a genuinely empty history never triggers a confirmatory health check at all', () async {
      final primary = FakeProvider('twelveData', healthy: true)..candlesResult = const [];
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();
      primary.healthCheckCalls = 0; // reset the count from connect()'s own probe

      final result = await manager.getHistoricalCandles('AAPL', Timeframe.h1);

      expect(result, isEmpty);
      expect(primary.healthCheckCalls, 0); // no confirmatory health check was made
    });

    test('even if an unrelated health check would fail right now, a genuinely empty history never spuriously flips the manager to providerError', () async {
      final primary = FakeProvider('twelveData', healthy: true)..candlesResult = const [];
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      // Simulates the "unrelated health check blip" Known Issue D warns
      // about: if the old code still called _handleFailure here, this
      // flips it to unhealthy and (with no secondary enabled) the whole
      // manager would incorrectly transition to providerError, even though
      // the candle fetch itself was a genuine, healthy empty result.
      primary.healthy = false;

      final result = await manager.getHistoricalCandles('AAPL', Timeframe.h1);

      expect(result, isEmpty);
      expect(manager.mode, MarketDataMode.live); // never spuriously flipped
      expect(manager.activeProvider, primary);
    });

    test('a real candle fetch failure fails over to a healthy secondary and returns its data', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..candlesException = const MarketFetchException(MarketFetchFailureKind.providerError, 'boom');
      final secondary = FakeProvider('alpaca', healthy: true)
        ..candlesResult = [MarketCandle(time: DateTime(2026), open: 1, high: 1, low: 1, close: 1)];
      final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: true);
      await manager.connect();

      // Primary goes unhealthy between connect() and the next call, same
      // pattern as the existing getQuote failover test above.
      primary.healthy = false;
      final result = await manager.getHistoricalCandles('AAPL', Timeframe.h1);

      expect(result, hasLength(1));
      expect(manager.activeProvider, secondary);
    });

    test('a real fault is never cached as a false empty result - a retry after recovery gets real data', () async {
      final primary = FakeProvider('twelveData', healthy: true)
        ..candlesException = const MarketFetchException(MarketFetchFailureKind.offline, 'down');
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      await expectLater(manager.getHistoricalCandles('AAPL', Timeframe.h1), throwsA(isA<MarketFetchException>()));

      // If the failed fetch had been cached as an empty result, this would
      // incorrectly return [] instead of trying the provider again.
      primary.candlesException = null;
      primary.candlesResult = [MarketCandle(time: DateTime(2026), open: 1, high: 1, low: 1, close: 1)];
      final result = await manager.getHistoricalCandles('AAPL', Timeframe.h1);

      expect(result, hasLength(1));
    });
  });

  group('2026-09-15 post-audit task (Finding 1) — _handleFailure never leaks an unhandled chained future', () {
    test('the shared failure-handling future clears after a successful (transient) confirmation, allowing a fresh call next time', () async {
      final primary = FakeProvider('twelveData', healthy: true, quoteResult: null); // healthy but empty - triggers _handleFailure
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();
      primary.healthCheckCalls = 0;

      await manager.getQuote('AAPL'); // triggers _handleFailure -> healthCheck() confirms healthy, no state change
      expect(primary.healthCheckCalls, 1);

      // A second, independent call must trigger its OWN confirmatory check
      // - if the shared future had never cleared, this would silently reuse
      // the first (already-settled) future instead of checking again.
      await manager.getQuote('AAPL');
      expect(primary.healthCheckCalls, 2);
    });

    test('the shared failure-handling future clears after failing over (the error path), allowing a fresh call next time', () async {
      final primary = FakeProvider('twelveData', healthy: true, quoteResult: null)..quoteException = const MarketFetchException(MarketFetchFailureKind.providerError, 'boom');
      final secondary = FakeProvider('alpaca', healthy: true, quoteResult: _quote('AAPL', 1));
      final manager = MarketProviderManager(primary: primary, secondary: secondary, secondaryEnabled: true);
      await manager.connect();

      // Primary faults - _handleFailure fails over to secondary.
      primary.healthy = false;
      final first = await manager.getQuote('AAPL');
      expect(first?.price, 1);
      expect(manager.activeProvider, secondary);

      // Secondary now also goes unhealthy - a second, independent
      // _handleFailure call must run its own fresh confirmation rather than
      // reusing a future left dangling from the first call.
      secondary.healthy = false;
      secondary.quoteResult = null;
      await manager.getQuote('AAPL');
      expect(manager.activeProvider, isNull);
      expect(manager.mode, MarketDataMode.providerError);
    });
  });

  group('2026-09-15 post-audit task (Finding 2 & 3) — watchQuotes/watchCandles reference counting and controller lifecycle', () {
    test('two simultaneous listeners for the same symbol: cancelling one keeps it subscribed; cancelling the last releases it', () async {
      final primary = FakeProvider('twelveData', healthy: true);
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      final receivedA = <MarketQuote>[];
      final receivedB = <MarketQuote>[];
      final subA = manager.watchQuotes(['AAPL']).listen(receivedA.add);
      await Future<void>.delayed(Duration.zero);
      final subB = manager.watchQuotes(['AAPL']).listen(receivedB.add);
      await Future<void>.delayed(Duration.zero);

      primary.emitTick(_quote('AAPL', 100));
      await Future<void>.delayed(Duration.zero);
      expect(receivedA, hasLength(1));
      expect(receivedB, hasLength(1));

      // Cancel the FIRST listener - AAPL is still needed by B, so it must
      // stay subscribed: no unsubscribeQuotes call yet.
      await subA.cancel();
      expect(primary.unsubscribeQuotesCalls, 0);

      primary.emitTick(_quote('AAPL', 200));
      await Future<void>.delayed(Duration.zero);
      expect(receivedB, hasLength(2)); // B still receives ticks after A cancelled

      // Cancel the LAST listener - now AAPL must actually be released.
      await subB.cancel();
      expect(primary.unsubscribeQuotesCalls, 1);
      expect(primary.unsubscribedSymbols, ['AAPL']);
    });

    test('watchCandles shares the same per-symbol reference count as watchQuotes', () async {
      final primary = FakeProvider('twelveData', healthy: true);
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      final quoteSub = manager.watchQuotes(['XAU/USD']).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      final candleSub = manager.watchCandles('XAU/USD', Timeframe.h1).listen((_) {});
      await Future<void>.delayed(Duration.zero);

      // The quote listener cancels first - the candle listener still needs
      // XAU/USD, so it must not be released yet.
      await quoteSub.cancel();
      expect(primary.unsubscribeQuotesCalls, 0);

      await candleSub.cancel();
      expect(primary.unsubscribeQuotesCalls, 1);
      expect(primary.unsubscribedSymbols, ['XAU/USD']);
    });

    test('unrelated symbols are never released early - only the cancelled subscription\'s own symbols are considered', () async {
      final primary = FakeProvider('twelveData', healthy: true);
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      final subAapl = manager.watchQuotes(['AAPL']).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      final subBtc = manager.watchQuotes(['BTC']).listen((_) {});
      await Future<void>.delayed(Duration.zero);

      await subAapl.cancel();

      expect(primary.unsubscribedSymbols, ['AAPL']);
      expect(primary.unsubscribedSymbols, isNot(contains('BTC')));

      await subBtc.cancel();
      expect(primary.unsubscribedSymbols, containsAll(['AAPL', 'BTC']));
    });

    test('cancellation closes the manager\'s own per-call controller - re-listening requires a fresh watchQuotes call', () async {
      final primary = FakeProvider('twelveData', healthy: true);
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      final stream = manager.watchQuotes(['AAPL']);
      final sub = stream.listen((_) {});
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();

      // The SAME stream reference must now be permanently done - it must
      // never silently re-open a second upstream subscription for AAPL.
      final events = <String>[];
      final resub = stream.listen((_) => events.add('data'), onDone: () => events.add('done'));
      await Future<void>.delayed(Duration.zero);
      await resub.cancel();

      expect(events, ['done']);
      expect(primary.watchQuotesCalls, 1); // never a second upstream call via the closed controller
    });
  });

  group('2026-09-15 Home/Markets final user-visible audit (item 2) — no silent hang when no provider is available', () {
    test('watchQuotes surfaces a real error instead of a silent hang when no provider is available', () async {
      final primary = FakeProvider('twelveData', healthy: false); // no secondary configured - _active stays null after ensureConnected()

      final manager = MarketProviderManager(primary: primary);

      final events = <Object>[];
      final sub = manager.watchQuotes(['AAPL']).listen(
        events.add,
        onError: events.add,
        onDone: () => events.add('done'),
      );
      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events.single, isA<MarketFetchException>());
      expect((events.single as MarketFetchException).kind, MarketFetchFailureKind.offline);
      await sub.cancel();
    });

    test('watchCandles surfaces a real error instead of a silent hang when no provider is available', () async {
      final primary = FakeProvider('twelveData', healthy: false);

      final manager = MarketProviderManager(primary: primary);

      final events = <Object>[];
      final sub = manager.watchCandles('AAPL', Timeframe.h1).listen(
        events.add,
        onError: events.add,
        onDone: () => events.add('done'),
      );
      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events.single, isA<MarketFetchException>());
      expect((events.single as MarketFetchException).kind, MarketFetchFailureKind.offline);
      await sub.cancel();
    });

    test('watchQuotes still streams ticks normally once a provider becomes available - unaffected by the error-surfacing fix', () async {
      final primary = FakeProvider('twelveData', healthy: true);
      final manager = MarketProviderManager(primary: primary);
      await manager.connect();

      final received = <MarketQuote>[];
      final sub = manager.watchQuotes(['AAPL']).listen(received.add);
      await Future<void>.delayed(Duration.zero);

      primary.emitTick(_quote('AAPL', 100));
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      await sub.cancel();
    });
  });
}
