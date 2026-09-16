import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/network/api_state.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_symbol_info.dart';
import 'package:mkr/features/markets/application/markets_controller.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:mkr/features/watchlist/application/watchlist_controller.dart';
import 'package:mkr/features/watchlist/domain/watchlist_repository.dart';

// 2026-09-16 post-phone Closed Testing correction task (root cause):
// MarketsController no longer calls MarketService.getAllQuotes() (the whole
// catalog) - it's catalog-first + controlled/lazy loading: getCatalog()
// (no provider cost) up front, then ONE getQuotesFor() call for a small
// initial page, with category/search selections fetching only what's
// still missing for that filter. These tests exercise that redesign
// directly; the pre-existing mode/ApiState contract tests (2026-09-15
// frontend hardening task) are preserved against the new request path.

MarketQuote _quote(String symbol, double price, {AssetClass assetClass = AssetClass.usStock}) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: assetClass,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

MarketSymbolInfo _symbol(String symbol, {required int sortOrder, bool featured = false, AssetClass assetClass = AssetClass.usStock}) =>
    MarketSymbolInfo(symbol: symbol, displayName: symbol, assetClass: assetClass, featured: featured, sortOrder: sortOrder);

class _FakeMarketService implements MarketService {
  _FakeMarketService({this.catalog = const [], this.quotesForResult = const MarketFetchEmpty(), this.getCatalogException});

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  List<MarketSymbolInfo> catalog;
  MarketFetchResult quotesForResult;
  MarketFetchException? getCatalogException;

  /// Per-call override, keyed by 0-based call index - falls back to
  /// [quotesForResult] when unset for that index.
  final Map<int, MarketFetchResult> quotesForResultByCallIndex = {};

  /// Every [getQuotesFor] call's argument, in order - lets a test assert
  /// exactly how many batched calls happened and what each one requested.
  final List<List<String>> requestedSymbolsLog = [];
  List<String>? get lastRequestedSymbols => requestedSymbolsLog.isEmpty ? null : requestedSymbolsLog.last;
  int get getQuotesForCallCount => requestedSymbolsLog.length;

  /// When set, each successive [getQuotesFor] call resolves from the next
  /// completer in order instead of returning immediately - 2026-09-15
  /// Home/Markets final user-visible audit (item 3): lets a test control
  /// exactly when each of two overlapping fetches resolves, and in which
  /// order.
  List<Completer<MarketFetchResult>>? getQuotesForCompleters;

  @override
  Future<List<MarketSymbolInfo>> getCatalog() async {
    final ex = getCatalogException;
    if (ex != null) throw ex;
    return catalog;
  }

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty(); // unused by MarketsController - see market_service.dart's doc comment

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async {
    final index = requestedSymbolsLog.length;
    requestedSymbolsLog.add(symbols);
    final completers = getQuotesForCompleters;
    if (completers != null) return completers[index].future;
    return quotesForResultByCallIndex[index] ?? quotesForResult;
  }

  @override
  Future<MarketQuote?> getQuote(String symbol) async => null;

  @override
  Future<List<double>> getPriceSeries(String symbol, ChartTimeframe timeframe) async => const [];

  @override
  Future<MarketFetchResult> search(String query) async => const MarketFetchEmpty();

  @override
  Stream<List<MarketQuote>> watchQuotes(List<String> symbols) => const Stream.empty();

  @override
  Stream<List<MarketCandle>> watchCandles(String symbol, Timeframe timeframe) => const Stream.empty();

  @override
  Future<void> reconnect() async {}

  @override
  void pause() {}

  @override
  void resume() {}
}

class _FakeWatchlistRepository implements WatchlistRepository {
  _FakeWatchlistRepository(this._symbols);
  List<String> _symbols;

  @override
  Future<List<String>> getSymbols() async => _symbols;

  @override
  Future<void> setSymbols(List<String> symbols) async => _symbols = symbols;
}

void main() {
  group('MarketsController — never LIVE + No markets available', () {
    test('a provider failure becomes ApiState.error, never ApiState.empty - scenario 1/3', () async {
      final service = _FakeMarketService(
        catalog: [_symbol('AAPL', sortOrder: 0, featured: true)],
        quotesForResult: const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Market data provider rate limit reached.'),
      );
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiError<List<MarketQuote>>>());
      // The exact contradiction this task closes: mode must never render as
      // LIVE/STALE alongside an error state.
      expect(controller.mode.effectiveFor(controller.state), isNot(MarketDataMode.live));
    });

    test('a partial batch keeps the valid quotes visible AND marks the state degraded - scenario 2', () async {
      final service = _FakeMarketService(
        catalog: [_symbol('AAPL', sortOrder: 0, featured: true), _symbol('MSFT', sortOrder: 1)],
        quotesForResult: MarketFetchPartial([_quote('AAPL', 100)], ['MSFT']),
      );
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiSuccess<List<MarketQuote>>>());
      expect(controller.state.dataOrNull, hasLength(1));
      expect(controller.state.isPartial, isTrue);
      // A partial success is still real, valid data - LIVE remains honest here.
      expect(controller.mode.effectiveFor(controller.state), MarketDataMode.live);
    });

    test('a genuine empty result is ApiState.empty, not an error - scenario 4', () async {
      final service = _FakeMarketService(catalog: [_symbol('AAPL', sortOrder: 0, featured: true)]);
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiEmpty<List<MarketQuote>>>());
    });

    test('a full success is ApiState.success with isPartial false, and LIVE is honestly shown', () async {
      final service = _FakeMarketService(
        catalog: [_symbol('AAPL', sortOrder: 0, featured: true), _symbol('MSFT', sortOrder: 1)],
        quotesForResult: MarketFetchSuccess([_quote('AAPL', 100), _quote('MSFT', 200)]),
      );
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiSuccess<List<MarketQuote>>>());
      expect(controller.state.isPartial, isFalse);
      expect(controller.mode.effectiveFor(controller.state), MarketDataMode.live);
    });
  });

  group('MarketsController — 2026-09-16 post-phone Closed Testing correction task (root cause): catalog-first + controlled/lazy loading', () {
    List<MarketSymbolInfo> tenSymbolCatalog() => [
          _symbol('F0', sortOrder: 0, featured: true),
          for (var i = 1; i <= 8; i++) _symbol('U$i', sortOrder: i),
          _symbol('U9', sortOrder: 9, assetClass: AssetClass.crypto), // deliberately excluded from the 8-symbol initial page
        ];

    test('the initial load requests only a small catalog-derived page (8 symbols), never the whole 10-symbol catalog', () async {
      final service = _FakeMarketService(catalog: tenSymbolCatalog());
      MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(service.getQuotesForCallCount, 1);
      expect(service.requestedSymbolsLog.single, hasLength(8));
      expect(service.requestedSymbolsLog.single, isNot(contains('U9'))); // beyond the initial page
    });

    test('selecting a category discovers a catalog symbol that was not part of the initial page', () async {
      final service = _FakeMarketService(catalog: tenSymbolCatalog());
      service.quotesForResultByCallIndex[1] = MarketFetchSuccess([_quote('U9', 42, assetClass: AssetClass.crypto)]);
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);
      expect(service.getQuotesForCallCount, 1); // just the initial page so far

      controller.setCategory(AssetClass.crypto);
      await Future<void>.delayed(Duration.zero);

      expect(service.getQuotesForCallCount, 2);
      expect(service.requestedSymbolsLog[1], ['U9']); // only the missing symbol, not the whole catalog again
      expect(controller.visibleQuotes().map((q) => q.symbol), ['U9']);
    });

    test('quotes already resolved from the initial page are retained when switching category - no redundant re-fetch', () async {
      final service = _FakeMarketService(
        catalog: [
          _symbol('F0', sortOrder: 0, featured: true, assetClass: AssetClass.gold),
          _symbol('U1', sortOrder: 1),
        ],
        quotesForResult: MarketFetchSuccess([_quote('F0', 1, assetClass: AssetClass.gold), _quote('U1', 2)]),
      );
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);
      expect(service.getQuotesForCallCount, 1);

      controller.setCategory(AssetClass.gold); // F0 already resolved from the initial page
      await Future<void>.delayed(Duration.zero);

      expect(service.getQuotesForCallCount, 1); // no new fetch needed
      expect(controller.visibleQuotes().map((q) => q.symbol), ['F0']);
    });

    test('typing a search query discovers a catalog symbol that was not part of the initial page', () async {
      final service = _FakeMarketService(catalog: tenSymbolCatalog());
      service.quotesForResultByCallIndex[1] = MarketFetchSuccess([_quote('U9', 7, assetClass: AssetClass.crypto)]);
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      controller.setQuery('U9');
      await Future<void>.delayed(Duration.zero);

      expect(service.getQuotesForCallCount, 2);
      expect(service.requestedSymbolsLog[1], ['U9']);
    });

    test('refresh() re-fetches only the currently filtered view, not the whole catalog', () async {
      final service = _FakeMarketService(catalog: tenSymbolCatalog());
      service.quotesForResultByCallIndex[1] = MarketFetchSuccess([_quote('U9', 7, assetClass: AssetClass.crypto)]);
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);
      controller.setCategory(AssetClass.crypto);
      await Future<void>.delayed(Duration.zero);
      expect(service.getQuotesForCallCount, 2);

      service.quotesForResultByCallIndex[2] = MarketFetchSuccess([_quote('U9', 8, assetClass: AssetClass.crypto)]);
      await controller.refresh();

      expect(service.getQuotesForCallCount, 3);
      expect(service.requestedSymbolsLog[2], ['U9']); // only the crypto category's own symbol, not all 10
    });

    test('a single fetch never requests more than the provider-safe cap, even for a category matching more symbols', () async {
      final manySymbols = [for (var i = 0; i < 12; i++) _symbol('SYM$i', sortOrder: i, assetClass: AssetClass.forex)];
      final service = _FakeMarketService(catalog: manySymbols);
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);
      // The initial page itself is already forex-only here (12 symbols,
      // all matching one category) - selecting that category explicitly
      // must still never exceed the cap even though 12 catalog entries match.
      controller.setCategory(AssetClass.forex);
      await Future<void>.delayed(Duration.zero);

      for (final call in service.requestedSymbolsLog) {
        expect(call.length, lessThanOrEqualTo(8));
      }
    });

    test('a catalog-load failure surfaces as ApiState.error, never a silent empty state', () async {
      final service = _FakeMarketService(getCatalogException: const MarketFetchException(MarketFetchFailureKind.offline, 'catalog down'));
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiError<List<MarketQuote>>>());
    });
  });

  group('MarketsController — 2026-09-15 Home/Markets final user-visible audit (item 3) — overlapping refresh() race guard', () {
    test('a slower, older fetch finishing after a newer one never overwrites the newer result', () async {
      final firstCall = Completer<MarketFetchResult>();
      final secondCall = Completer<MarketFetchResult>();
      final service = _FakeMarketService(catalog: [_symbol('AAPL', sortOrder: 0, featured: true)])..getQuotesForCompleters = [firstCall, secondCall];

      // The constructor fires the first load (consumes firstCall).
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      // A second refresh() (e.g. pull-to-refresh tapped again) starts
      // before the first has resolved - consumes secondCall.
      final secondRefresh = controller.refresh();
      await Future<void>.delayed(Duration.zero);
      expect(service.getQuotesForCallCount, 2);

      // The NEWER call resolves first with real data.
      secondCall.complete(MarketFetchSuccess([_quote('AAPL', 999)]));
      await secondRefresh;
      await Future<void>.delayed(Duration.zero);

      expect(controller.state.dataOrNull?.single.price, 999);

      // The OLDER, slower call now finally resolves too - it must be
      // discarded, never overwriting the already-applied newer result.
      firstCall.complete(MarketFetchSuccess([_quote('AAPL', 1)]));
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state.dataOrNull?.single.price, 999);
    });

    test('a disposed controller never applies a still-in-flight fetch result', () async {
      final pending = Completer<MarketFetchResult>();
      final service = _FakeMarketService(catalog: [_symbol('AAPL', sortOrder: 0, featured: true)])..getQuotesForCompleters = [pending];

      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      controller.dispose();
      pending.complete(MarketFetchSuccess([_quote('AAPL', 1)]));

      // Must not throw (e.g. notifyListeners()-after-dispose) when the
      // in-flight fetch finally resolves after disposal.
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    });
  });

  group('WatchlistController — real quotes, never MockMarketCatalog, batched', () {
    test('fetches the saved symbols in one batch call and preserves the saved order', () async {
      final service = _FakeMarketService(
        quotesForResult: MarketFetchSuccess([_quote('MSFT', 2), _quote('AAPL', 1)]), // backend order differs from saved order
      );
      final controller = WatchlistController(_FakeWatchlistRepository(['AAPL', 'MSFT']), service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final quotes = controller.state.dataOrNull;
      expect(quotes?.map((q) => q.symbol).toList(), ['AAPL', 'MSFT']); // re-sorted to the user's saved order
    });

    test('a provider failure becomes ApiState.error, never a false empty watchlist', () async {
      final service = _FakeMarketService(quotesForResult: const MarketFetchFailure(MarketFetchFailureKind.offline, 'Could not reach the market data service.'));
      final controller = WatchlistController(_FakeWatchlistRepository(['AAPL']), service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiError<List<MarketQuote>>>());
    });

    test('an empty saved watchlist is a genuine empty state without calling the market service', () async {
      final service = _FakeMarketService();
      final controller = WatchlistController(_FakeWatchlistRepository(const []), service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiEmpty<List<MarketQuote>>>());
    });
  });
}
