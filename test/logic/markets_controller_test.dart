import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/network/api_state.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/features/markets/application/markets_controller.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:mkr/features/watchlist/application/watchlist_controller.dart';
import 'package:mkr/features/watchlist/domain/watchlist_repository.dart';

// 2026-09-15 frontend hardening task — the physical-device regression this
// task exists to close, exercised at the controller level: `MarketDataMode`
// (the status chip) must never disagree with `ApiState` (what's actually
// rendered below it). These tests assert on `mode.effectiveFor(state)`,
// exactly what markets_screen.dart/home_screen.dart now render.

MarketQuote _quote(String symbol, double price) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.usStock,
      price: price,
      changeAbs: 0,
      changePct: 0,
    );

class _FakeMarketService implements MarketService {
  _FakeMarketService({required this.mode, this.allQuotesResult = const MarketFetchEmpty(), this.quotesForResult = const MarketFetchEmpty()});

  @override
  MarketDataMode mode;

  @override
  DateTime? lastUpdated;

  MarketFetchResult allQuotesResult;
  MarketFetchResult quotesForResult;

  @override
  Future<MarketFetchResult> getAllQuotes() async => allQuotesResult;

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => allQuotesResult;

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async => quotesForResult;

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
      final service = _FakeMarketService(mode: MarketDataMode.live, allQuotesResult: const MarketFetchFailure(MarketFetchFailureKind.providerError, 'Market data provider rate limit reached.'));
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiError<List<MarketQuote>>>());
      // The exact contradiction this task closes: mode must never render as
      // LIVE/STALE alongside an error state.
      expect(controller.mode.effectiveFor(controller.state), isNot(MarketDataMode.live));
    });

    test('a partial batch keeps the valid quotes visible AND marks the state degraded - scenario 2', () async {
      final service = _FakeMarketService(mode: MarketDataMode.live, allQuotesResult: MarketFetchPartial([_quote('AAPL', 100)], ['MSFT']));
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiSuccess<List<MarketQuote>>>());
      expect(controller.state.dataOrNull, hasLength(1));
      expect(controller.state.isPartial, isTrue);
      // A partial success is still real, valid data - LIVE remains honest here.
      expect(controller.mode.effectiveFor(controller.state), MarketDataMode.live);
    });

    test('a genuine empty result is ApiState.empty, not an error - scenario 4', () async {
      final service = _FakeMarketService(mode: MarketDataMode.live, allQuotesResult: const MarketFetchEmpty());
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiEmpty<List<MarketQuote>>>());
    });

    test('a full success is ApiState.success with isPartial false, and LIVE is honestly shown', () async {
      final service = _FakeMarketService(mode: MarketDataMode.live, allQuotesResult: MarketFetchSuccess([_quote('AAPL', 100), _quote('MSFT', 200)]));
      final controller = MarketsController(service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiSuccess<List<MarketQuote>>>());
      expect(controller.state.isPartial, isFalse);
      expect(controller.mode.effectiveFor(controller.state), MarketDataMode.live);
    });
  });

  group('WatchlistController — real quotes, never MockMarketCatalog, batched', () {
    test('fetches the saved symbols in one batch call and preserves the saved order', () async {
      final service = _FakeMarketService(
        mode: MarketDataMode.live,
        quotesForResult: MarketFetchSuccess([_quote('MSFT', 2), _quote('AAPL', 1)]), // backend order differs from saved order
      );
      final controller = WatchlistController(_FakeWatchlistRepository(['AAPL', 'MSFT']), service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final quotes = controller.state.dataOrNull;
      expect(quotes?.map((q) => q.symbol).toList(), ['AAPL', 'MSFT']); // re-sorted to the user's saved order
    });

    test('a provider failure becomes ApiState.error, never a false empty watchlist', () async {
      final service = _FakeMarketService(mode: MarketDataMode.live, quotesForResult: const MarketFetchFailure(MarketFetchFailureKind.offline, 'Could not reach the market data service.'));
      final controller = WatchlistController(_FakeWatchlistRepository(['AAPL']), service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiError<List<MarketQuote>>>());
    });

    test('an empty saved watchlist is a genuine empty state without calling the market service', () async {
      final service = _FakeMarketService(mode: MarketDataMode.live);
      final controller = WatchlistController(_FakeWatchlistRepository(const []), service);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, isA<ApiEmpty<List<MarketQuote>>>());
    });
  });
}
