import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/price_chart.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_candle.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';
import 'package:mkr/features/markets/domain/market_service.dart';
import 'package:mkr/features/markets/domain/timeframe.dart';
import 'package:mkr/features/portfolio/application/portfolio_controller.dart';
import 'package:mkr/features/portfolio/domain/portfolio_holding.dart';
import 'package:mkr/features/portfolio/domain/portfolio_repository.dart';

// 2026-09-15 FINAL correction task, point 2 — PortfolioController must price
// real-mode holdings from MarketService.getQuotesFor() (one batched,
// catalog-authorized call), never MockMarketCatalog, and must never
// fabricate a value for a symbol whose quote didn't resolve.

MarketQuote _quote(String symbol, double price, {double changeAbs = 0}) => MarketQuote(
      symbol: symbol,
      name: symbol,
      assetClass: AssetClass.usStock,
      price: price,
      changeAbs: changeAbs,
      changePct: 0,
    );

class _FakeRepository implements PortfolioRepository {
  _FakeRepository(this._holdings);
  List<PortfolioHolding> _holdings;

  @override
  Future<List<PortfolioHolding>> getHoldings() async => _holdings;

  @override
  Future<void> saveHoldings(List<PortfolioHolding> holdings) async {
    _holdings = holdings;
  }
}

class _FakeMarketService implements MarketService {
  _FakeMarketService({this.quotesResult = const MarketFetchEmpty()});

  MarketFetchResult quotesResult;
  List<String>? lastGetQuotesForSymbols;
  int getQuotesForCallCount = 0;

  @override
  MarketDataMode mode = MarketDataMode.live;

  @override
  DateTime? lastUpdated;

  @override
  Future<MarketFetchResult> getAllQuotes() async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesByCategory(AssetClass assetClass) async => const MarketFetchEmpty();

  @override
  Future<MarketFetchResult> getQuotesFor(List<String> symbols) async {
    lastGetQuotesForSymbols = symbols;
    getQuotesForCallCount++;
    return quotesResult;
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

void main() {
  group('PortfolioController — 2026-09-15 FINAL correction task (point 2)', () {
    test('real-mode valuation/P&L comes from one batched getQuotesFor call, never MockMarketCatalog', () async {
      final repo = _FakeRepository([
        const PortfolioHolding(symbol: 'AAPL', quantity: 10, avgPrice: 100),
        const PortfolioHolding(symbol: 'BTC', quantity: 1, avgPrice: 20000),
      ]);
      final service = _FakeMarketService(
        quotesResult: MarketFetchSuccess([
          _quote('AAPL', 150, changeAbs: 2),
          _quote('BTC', 25000, changeAbs: 500),
        ]),
      );
      final controller = PortfolioController(repo, service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(service.getQuotesForCallCount, 1); // one batch call, not N individual fetches
      expect(service.lastGetQuotesForSymbols, containsAll(['AAPL', 'BTC']));

      final summary = controller.state.dataOrNull;
      expect(summary, isNotNull);
      final aaplLine = summary!.lines.firstWhere((l) => l.holding.symbol == 'AAPL');
      expect(aaplLine.currentPrice, 150); // real fetched price, never a mock value
      expect(aaplLine.totalPL, (150 - 100) * 10);
    });

    test('a holding whose quote did not resolve is priced honestly at cost (0 P&L), never fabricated or dropped', () async {
      final repo = _FakeRepository([
        const PortfolioHolding(symbol: 'AAPL', quantity: 10, avgPrice: 100),
        const PortfolioHolding(symbol: 'DISABLEDSYM', quantity: 5, avgPrice: 50),
      ]);
      final service = _FakeMarketService(
        quotesResult: MarketFetchPartial([_quote('AAPL', 150)], ['DISABLEDSYM']),
      );
      final controller = PortfolioController(repo, service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final summary = controller.state.dataOrNull;
      expect(summary, isNotNull);
      expect(summary!.lines.map((l) => l.holding.symbol), containsAll(['AAPL', 'DISABLEDSYM']));
      final line = summary.lines.firstWhere((l) => l.holding.symbol == 'DISABLEDSYM');
      expect(line.currentPrice, 50); // falls back to avgPrice, never invented
      expect(line.totalPL, 0);
    });

    test('market-service failure never fabricates - every holding degrades honestly to cost basis', () async {
      final repo = _FakeRepository([const PortfolioHolding(symbol: 'AAPL', quantity: 10, avgPrice: 100)]);
      final service = _FakeMarketService(quotesResult: const MarketFetchFailure(MarketFetchFailureKind.offline, 'down'));
      final controller = PortfolioController(repo, service);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final summary = controller.state.dataOrNull;
      expect(summary, isNotNull);
      expect(summary!.lines.single.currentPrice, 100);
      expect(summary.lines.single.totalPL, 0);
    });

    test('adding a holding refreshes the valuation via one new batch call - never a request storm', () async {
      final repo = _FakeRepository([]);
      final service = _FakeMarketService(quotesResult: MarketFetchSuccess([_quote('AAPL', 150)]));
      final controller = PortfolioController(repo, service);
      await Future<void>.delayed(Duration.zero);
      expect(service.getQuotesForCallCount, 0); // empty portfolio never calls the market service

      await controller.addHolding(const PortfolioHolding(symbol: 'AAPL', quantity: 1, avgPrice: 100));

      expect(service.getQuotesForCallCount, 1);
      expect(controller.state.dataOrNull!.lines.single.currentPrice, 150);
    });

    test('an empty portfolio never calls the market service at all', () async {
      final repo = _FakeRepository([]);
      final service = _FakeMarketService();
      PortfolioController(repo, service);
      await Future<void>.delayed(Duration.zero);

      expect(service.getQuotesForCallCount, 0);
    });
  });
}
