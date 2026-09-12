import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/market_data_mode.dart';
import 'package:mkr/features/markets/data/mock_market_service.dart';

void main() {
  test('MockMarketService never reports live — only demo', () {
    final service = MockMarketService();
    expect(service.mode, MarketDataMode.demo);
    expect(service.mode, isNot(MarketDataMode.live));
  });

  test('lastUpdated is null before any fetch, then set after one', () async {
    final service = MockMarketService();
    expect(service.lastUpdated, isNull);
    await service.getAllQuotes();
    expect(service.lastUpdated, isNotNull);
  });

  test('watchQuotes emits at least one update for the requested symbols', () async {
    final service = MockMarketService();
    final update = await service.watchQuotes(['BTC', 'XAU/USD']).first.timeout(
          const Duration(seconds: 6),
        );
    expect(update, isNotEmpty);
    expect(update.map((q) => q.symbol), containsAll(['BTC', 'XAU/USD']));
    expect(service.lastUpdated, isNotNull);
  });
}
