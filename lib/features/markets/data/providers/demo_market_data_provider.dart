import 'dart:async';
import 'dart:math';

import '../../../../data/mock_market_catalog.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_data_source.dart';
import '../../../../domain/market_quote.dart';
import '../../../../domain/market_session_status.dart';
import '../../domain/market_data_provider.dart';
import '../../domain/timeframe.dart';
import '../demo_market_simulator.dart';

/// Thin [MarketDataProvider] adapter over the existing [DemoMarketSimulator]
/// — lets [MarketProviderManager] exercise its failover/health-check logic
/// against a fast, deterministic in-memory source in tests, without needing
/// a real Twelve Data/Alpaca connection. Not used by the production demo
/// path today ([MockMarketService] still serves that directly); this exists
/// so the provider architecture has one uniform shape end to end.
class DemoMarketDataProvider implements MarketDataProvider {
  DemoMarketDataProvider({Random? random}) : _simulator = DemoMarketSimulator(seed: MockMarketCatalog.all, random: random);

  @override
  final String id = 'demo';

  final DemoMarketSimulator _simulator;
  Timer? _ticker;
  final _quoteController = StreamController<MarketQuote>.broadcast();

  MarketQuote _tagged(MarketQuote quote) => quote.copyWith(source: MarketDataSource.demo, isLive: false);

  @override
  Future<void> connect() async {
    _ticker ??= Timer.periodic(const Duration(milliseconds: 500), (_) {
      for (final quote in _simulator.tickAll()) {
        if (!_quoteController.isClosed) _quoteController.add(_tagged(quote));
      }
    });
  }

  @override
  Future<void> disconnect() async {
    _ticker?.cancel();
    _ticker = null;
  }

  @override
  Future<bool> healthCheck() async => true;

  @override
  Future<MarketQuote?> getQuote(String symbol) async {
    final quote = _simulator.currentQuote(symbol);
    return quote == null ? null : _tagged(quote);
  }

  @override
  Future<List<MarketQuote>> getQuotes(List<String> symbols) async {
    return symbols.map(_simulator.currentQuote).whereType<MarketQuote>().map(_tagged).toList();
  }

  @override
  Future<List<MarketCandle>> getHistoricalCandles(String symbol, Timeframe timeframe) async {
    return _simulator.currentCandles(symbol);
  }

  @override
  Future<MarketSessionStatus> getMarketStatus(String market) async => MarketSessionStatus.open;

  @override
  Stream<MarketQuote> watchQuotes(List<String> symbols) {
    return _quoteController.stream.where((q) => symbols.contains(q.symbol));
  }

  @override
  Stream<MarketCandle> watchCandles(String symbol, Timeframe timeframe) {
    return _quoteController.stream
        .where((q) => q.symbol == symbol)
        .map((_) => _simulator.currentCandles(symbol))
        .where((candles) => candles.isNotEmpty)
        .map((candles) => candles.last);
  }
}
