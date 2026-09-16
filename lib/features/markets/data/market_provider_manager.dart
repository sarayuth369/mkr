import 'dart:async';

import '../../../domain/market_candle.dart';
import '../../../domain/market_data_mode.dart';
import '../../../domain/market_quote.dart';
import '../../../domain/market_session_status.dart';
import '../domain/market_data_provider.dart';
import '../domain/market_fetch_result.dart';
import '../domain/timeframe.dart';
import 'candle_cache.dart';

/// The provider health/failover engine:
/// `Twelve Data (primary) → [health check] → Alpaca (secondary, if enabled)`,
/// modeled on `auc/backend`'s crypto-provider fallback pattern (try in
/// priority order, stop at the first healthy one).
///
/// The critical rule this class exists to enforce: **a quiet market is not
/// a provider failure.** [MarketSessionStatus] (the exchange's schedule) is
/// looked up separately from [healthCheck] (this provider's own
/// reachability) — failover only ever happens because [healthCheck] says a
/// provider is actually unreachable, never because ticks stopped arriving
/// (which is expected and normal outside trading hours).
class MarketProviderManager {
  MarketProviderManager({
    required this.primary,
    this.secondary,
    this.secondaryEnabled = false,
    CandleCache? candleCache,
    Duration? staleAfter,
  })  : _candleCache = candleCache ?? CandleCache(),
        _staleAfter = staleAfter ?? const Duration(seconds: 60);

  final MarketDataProvider primary;
  final MarketDataProvider? secondary;
  final bool secondaryEnabled;
  final CandleCache _candleCache;
  final Duration _staleAfter;

  MarketDataMode _rawMode = MarketDataMode.offline;
  DateTime? _lastUpdated;
  MarketDataProvider? _active;
  Future<void>? _connectFuture;

  /// Client-side single-flight for [getQuotes], keyed by the exact
  /// (sorted) symbol set — 2026-09-15 hardening task: "Prevent duplicate
  /// initial loads from creating unnecessary repeated requests when
  /// controllers/widgets are constructed concurrently." Home/Markets/
  /// Watchlist can all construct around the same app-startup moment and
  /// request the identical catalog; without this each would fire its own
  /// real HTTP request for the same data.
  final Map<String, Future<MarketFetchResult>> _inFlightQuotes = {};

  /// The currently active provider, if any — exposed for tests/telemetry.
  MarketDataProvider? get activeProvider => _active;

  DateTime? get lastUpdated => _lastUpdated;

  /// [_rawMode] downgraded to [MarketDataMode.stale] when the last
  /// successful update is older than [_staleAfter], even though the
  /// connection itself is still nominally "live".
  MarketDataMode get mode {
    if (_rawMode == MarketDataMode.live &&
        _lastUpdated != null &&
        DateTime.now().difference(_lastUpdated!) > _staleAfter) {
      return MarketDataMode.stale;
    }
    return _rawMode;
  }

  /// Always starts a fresh connection attempt and updates [ensureConnected]'s
  /// shared future to point at it — used for an explicit reconnect (e.g.
  /// [ProviderBackedMarketService.resume] after the app was backgrounded).
  Future<void> connect() {
    final future = _doConnect();
    _connectFuture = future;
    return future;
  }

  Future<void> _doConnect() async {
    _rawMode = MarketDataMode.connecting;
    if (await _tryActivate(primary)) return;
    if (secondaryEnabled && secondary != null && await _tryActivate(secondary!)) return;
    _active = null;
    _rawMode = MarketDataMode.providerError;
  }

  /// Awaited by every data-fetching method below so a caller that starts
  /// querying immediately after construction (every controller does, in its
  /// own constructor) blocks on the SAME in-flight connection attempt kicked
  /// off at startup, instead of racing it and silently seeing `_active ==
  /// null` (confirmed live: without this, Home's first `getAllQuotes()` call
  /// always lost the race against the health-check, returning an empty list
  /// forever with no error and no retry). A no-op once already connected.
  Future<void> ensureConnected() => _connectFuture ?? connect();

  Future<bool> _tryActivate(MarketDataProvider provider) async {
    if (!await provider.healthCheck()) return false;
    await provider.connect();
    _active = provider;
    _rawMode = MarketDataMode.live;
    return true;
  }

  Future<void> disconnect() async {
    await primary.disconnect();
    if (secondaryEnabled) await secondary?.disconnect();
    _active = null;
    _rawMode = MarketDataMode.offline;
  }

  Future<void> reconnect() => connect();

  Future<void>? _failureHandlingFuture;

  /// Called whenever [_active] returns an unavailable/empty result. Confirms
  /// via [MarketDataProvider.healthCheck] — never assumes failure from a
  /// single empty response, which could just as easily be a genuinely
  /// unsupported symbol or a quiet closed market — before failing over.
  ///
  /// [getAllQuotes] fires every catalog symbol concurrently via
  /// `Future.wait`, so several unsupported/unmapped symbols (e.g. ones the
  /// backend catalog disables or doesn't map for this provider) can each
  /// return null in the same instant. Without deduplication, each one would
  /// independently trigger its own healthCheck() call — a real network
  /// request — and any single one of those being slow/flaky/rate-limited
  /// could spuriously null out [_active] for the WHOLE manager, even while
  /// every other symbol is working fine (confirmed live: a Markets screen
  /// showing real prices for six symbols alongside a "PROVIDER UNAVAILABLE"
  /// status chip, caused by exactly this concurrent-storm race). Collapsing
  /// concurrent calls into one shared in-flight check removes the storm.
  Future<void> _handleFailure(MarketDataProvider failed) {
    return _failureHandlingFuture ??= _handleFailureAndClear(failed);
  }

  // 2026-09-15 post-audit task (Finding 1): a single async wrapper (not
  // `.whenComplete()` with the chained future discarded) - the identical
  // fix already applied to the quote single-flight path
  // (`_getQuotesAndClearInFlight`) and `MarketCatalogRepository`: an
  // unlistened chained future is "unhandled" in Dart even when the
  // ORIGINAL future (returned by `_handleFailure` above, and properly
  // awaited by every real caller) is caught correctly. Preserves the exact
  // same de-duplication semantics - concurrent `_handleFailure` calls still
  // share the one in-flight `_doHandleFailure`, and the shared future field
  // still clears once it settles, on both the success and error path.
  Future<void> _handleFailureAndClear(MarketDataProvider failed) async {
    try {
      await _doHandleFailure(failed);
    } finally {
      _failureHandlingFuture = null;
    }
  }

  Future<void> _doHandleFailure(MarketDataProvider failed) async {
    if (await failed.healthCheck()) return; // transient/expected, not a real failure

    if (failed == primary && secondaryEnabled && secondary != null && await _tryActivate(secondary!)) {
      return;
    }
    _active = null;
    _rawMode = MarketDataMode.providerError;
  }

  /// 2026-09-15 hardening task: a real fetch fault from the active provider
  /// no longer silently becomes `null` (indistinguishable from "no data for
  /// this symbol") — [MarketDataProvider.getQuote] now throws
  /// [MarketFetchException] for one, which this method catches so the
  /// EXISTING failover-to-secondary behavior is preserved (a caught fault
  /// still tries the fallback, exactly like a `null` always did), but the
  /// real error is surfaced to the caller once there is nothing left to
  /// try — never swallowed into a false "no data" result.
  Future<MarketQuote?> getQuote(String symbol) async {
    await ensureConnected();
    final active = _active;
    if (active == null) {
      throw const MarketFetchException(MarketFetchFailureKind.offline, 'No market data provider is currently available.');
    }

    MarketQuote? quote;
    Object? primaryError;
    try {
      quote = await active.getQuote(symbol);
    } catch (e) {
      primaryError = e;
    }
    if (quote != null) {
      _lastUpdated = DateTime.now();
      return quote;
    }

    await _handleFailure(active);
    final fallback = _active;
    if (fallback == null || identical(fallback, active)) {
      if (primaryError != null) throw primaryError; // nothing left to try - surface the real fault
      return null; // primary genuinely had no data, no fallback available
    }
    try {
      final retried = await fallback.getQuote(symbol);
      if (retried != null) _lastUpdated = DateTime.now();
      return retried;
    } catch (e) {
      throw primaryError ?? e; // prefer surfacing the original fault if there was one
    }
  }

  /// ONE batched provider call for every symbol — looping [getQuote] here
  /// (even concurrently) would mean one upstream REST request per symbol
  /// for a single screen load, which is exactly the request storm this
  /// architecture exists to prevent (confirmed live against the deployed
  /// backend: ~28 concurrent individual quote calls exhausted Twelve Data
  /// Free's rate limit and every single one came back unavailable).
  ///
  /// 2026-09-15 hardening task: returns a typed [MarketFetchResult] instead
  /// of a bare list — [MarketFetchFailure] is confirmed via the same
  /// [_handleFailure] health-check discipline as [getQuote]/
  /// [getHistoricalCandles] before failing over, and `lastUpdated` only
  /// advances once real quote data was actually received (never on an
  /// empty/failed outcome).
  Future<MarketFetchResult> getQuotes(List<String> symbols) {
    if (symbols.isEmpty) return Future.value(const MarketFetchEmpty());
    final key = (List<String>.of(symbols)..sort()).join(',');
    final existing = _inFlightQuotes[key];
    if (existing != null) return existing;

    // A single async wrapper (not `.whenComplete()` with the chained future
    // discarded) - see MarketCatalogRepository's identical fix for why: an
    // unlistened chained future is "unhandled" in Dart even when the
    // ORIGINAL future is properly awaited elsewhere. [MarketDataProvider.getQuotes]
    // is documented to never throw, but this stays safe even if a provider
    // implementation ever violates that.
    final future = _getQuotesAndClearInFlight(key, symbols);
    _inFlightQuotes[key] = future;
    return future;
  }

  Future<MarketFetchResult> _getQuotesAndClearInFlight(String key, List<String> symbols) async {
    try {
      return await _getQuotesUncached(symbols);
    } finally {
      _inFlightQuotes.remove(key);
    }
  }

  Future<MarketFetchResult> _getQuotesUncached(List<String> symbols) async {
    await ensureConnected();
    final active = _active;
    if (active == null) {
      return const MarketFetchFailure(MarketFetchFailureKind.offline, 'No market data provider is currently available.');
    }

    final result = await active.getQuotes(symbols);
    if (result is MarketFetchSuccess || result is MarketFetchPartial) {
      if (result.quotes.isNotEmpty) _lastUpdated = DateTime.now();
      return result;
    }
    if (result is MarketFetchEmpty) return result;

    // MarketFetchFailure - confirm via health check before failing over,
    // same discipline as getQuote/getHistoricalCandles (never fail over on
    // a single unconfirmed blip).
    await _handleFailure(active);
    final fallback = _active;
    if (fallback == null || identical(fallback, active)) return result;
    final retried = await fallback.getQuotes(symbols);
    if ((retried is MarketFetchSuccess || retried is MarketFetchPartial) && retried.quotes.isNotEmpty) {
      _lastUpdated = DateTime.now();
    }
    return retried;
  }

  /// 2026-09-15 FINAL FINAL correction task (Defect 3): matches [getQuote]'s
  /// failure discipline exactly — a real fetch fault (from either provider,
  /// or "no provider connected at all") is no longer silently collapsed
  /// into an empty list. Empty stays reserved for a genuine "no history for
  /// this symbol" outcome.
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) {
    return _candleCache.getOrFetch(symbol, timeframe, () => _getHistoricalCandlesUncached(symbol, timeframe));
  }

  Future<List<MarketCandle>> _getHistoricalCandlesUncached(String symbol, Timeframe timeframe) async {
    await ensureConnected();
    final active = _active;
    if (active == null) {
      throw const MarketFetchException(MarketFetchFailureKind.offline, 'No market data provider is currently available.');
    }

    List<MarketCandle> candles;
    Object? primaryError;
    try {
      candles = await active.getHistoricalCandles(symbol, timeframe);
    } catch (e) {
      candles = const [];
      primaryError = e;
    }
    if (candles.isNotEmpty) return candles;

    // 2026-09-15 pre-Closed-Testing audit (Known Issue D): a genuinely
    // empty history (the provider call returned normally with nothing, no
    // exception - `primaryError == null`) is NOT a provider failure and
    // must not trigger a confirmatory health check at all. Unlike a real
    // fetch fault, there is nothing here to confirm - the provider is
    // known-fine, this symbol/timeframe combination simply has no data.
    // Calling `_handleFailure` anyway was pure downside: in the common
    // (healthy) case it burns an extra network request for no benefit and
    // changes nothing (the result was already going to be `[]`); in the
    // unlucky case where that UNRELATED health check itself blips, it
    // spuriously flips the WHOLE manager to providerError over a symbol
    // that was never actually a failure.
    if (primaryError == null) return const [];

    await _handleFailure(active);
    final fallback = _active;
    if (fallback == null || identical(fallback, active)) {
      throw primaryError; // nothing left to try - surface the real fault
    }
    try {
      final retried = await fallback.getHistoricalCandles(symbol, timeframe);
      return retried;
    } catch (e) {
      throw primaryError; // prefer surfacing the original fault
    }
  }

  Future<MarketSessionStatus> getMarketStatus(String market) async {
    await ensureConnected();
    final active = _active;
    if (active == null) return MarketSessionStatus.unknown;
    return active.getMarketStatus(market);
  }

  /// Reference count per symbol across every live [watchQuotes]/
  /// [watchCandles] subscriber — 2026-09-15 post-audit task (Finding 2):
  /// candles internally ride the same per-symbol quote subscription at the
  /// provider level (see [TwelveDataProvider.watchCandles]), so both share
  /// one counter here. A symbol is only released (unsubscribed from the
  /// active provider, via [MarketDataProvider.unsubscribeQuotes]) once the
  /// LAST subscriber referencing it cancels — two screens watching the same
  /// symbol correctly share one upstream subscription, and cancelling one
  /// doesn't cut off the other; previously nothing ever called
  /// `unsubscribeQuotes` at all, so a provider kept every symbol ever
  /// watched subscribed for the rest of the session.
  final Map<String, int> _symbolRefCounts = {};

  void _addSymbolRefs(Iterable<String> symbols) {
    for (final s in symbols) {
      _symbolRefCounts[s] = (_symbolRefCounts[s] ?? 0) + 1;
    }
  }

  void _releaseSymbolRefs(Iterable<String> symbols) {
    final toRelease = <String>[];
    for (final s in symbols) {
      final current = _symbolRefCounts[s];
      if (current == null) continue;
      if (current <= 1) {
        _symbolRefCounts.remove(s);
        toRelease.add(s);
      } else {
        _symbolRefCounts[s] = current - 1;
      }
    }
    if (toRelease.isNotEmpty) _active?.unsubscribeQuotes(toRelease);
  }

  /// A single shared subscription per requested symbol set — reused across
  /// every caller (Home/Markets/Watchlist/Detail) rather than opening a new
  /// provider stream per screen. 2026-09-15 post-audit task (Findings 2 &
  /// 3): each symbol is reference-counted (see [_addSymbolRefs]/
  /// [_releaseSymbolRefs]) and this call's own controller is explicitly
  /// closed once its subscriber cancels, so cancellation both releases only
  /// the symbols no other caller still needs AND leaves no abandoned
  /// controller alive across repeated screen creation/cancellation. Once
  /// closed, this specific controller can never be re-listened to (a fresh
  /// call to [watchQuotes] is required), so cancellation can never leave a
  /// duplicate upstream subscription behind.
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    late StreamController<MarketQuote> controller;
    StreamSubscription<MarketQuote>? subscription;
    controller = StreamController<MarketQuote>.broadcast(
      onListen: () async {
        _addSymbolRefs(symbols);
        await ensureConnected();
        if (controller.isClosed) return;
        final active = _active;
        if (active == null) {
          // 2026-09-15 Home/Markets final audit (item 2): previously just
          // returned here - a listener already attached got NO event at
          // all (no data, no error, no done) and stayed open forever with
          // no way to tell "provider unavailable" from "no ticks yet
          // because the market is quiet". Surfaced honestly instead, same
          // pattern already used one layer up for a catalog load failure.
          controller.addError(const MarketFetchException(MarketFetchFailureKind.offline, 'No market data provider is currently available.'));
          return;
        }
        subscription = active.watchQuotes(symbols).listen(
          (quote) {
            _lastUpdated = DateTime.now();
            if (!controller.isClosed) controller.add(quote);
          },
          // 2026-09-16 Final Release Gate audit finding: previously had no
          // `onError` at all - an error added to the underlying provider's
          // own stream (e.g. TwelveDataProvider surfacing a prolonged
          // reconnect failure) became an unhandled zone error right here
          // instead of reaching this manager's own `controller`, so it
          // never made it to `ProviderBackedMarketService`/
          // `MarketDetailController`'s listener at all - the exact
          // "surfaces honestly" contract this method already applies to
          // the "no provider available" case above, just not to a
          // downstream provider-level error.
          onError: (Object e) {
            if (!controller.isClosed) controller.addError(e);
          },
        );
      },
      onCancel: () async {
        await subscription?.cancel();
        subscription = null;
        _releaseSymbolRefs(symbols);
        if (!controller.isClosed) await controller.close();
      },
    );
    return controller.stream;
  }

  /// Same lifecycle discipline as [watchQuotes] (reference-counted release,
  /// controller explicitly closed on cancel) — see that method's doc
  /// comment.
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) {
    late StreamController<MarketCandle> controller;
    StreamSubscription<MarketCandle>? subscription;
    controller = StreamController<MarketCandle>.broadcast(
      onListen: () async {
        _addSymbolRefs([symbol]);
        await ensureConnected();
        if (controller.isClosed) return;
        final active = _active;
        if (active == null) {
          // 2026-09-15 Home/Markets final audit (item 2): same fix as
          // watchQuotes - never a silent hang.
          controller.addError(const MarketFetchException(MarketFetchFailureKind.offline, 'No market data provider is currently available.'));
          return;
        }
        subscription = active.watchCandles(symbol, timeframe).listen(
          (candle) {
            if (!controller.isClosed) controller.add(candle);
          },
          // See the identical fix/comment in watchQuotes above.
          onError: (Object e) {
            if (!controller.isClosed) controller.addError(e);
          },
        );
      },
      onCancel: () async {
        await subscription?.cancel();
        subscription = null;
        _releaseSymbolRefs([symbol]);
        if (!controller.isClosed) await controller.close();
      },
    );
    return controller.stream;
  }
}
