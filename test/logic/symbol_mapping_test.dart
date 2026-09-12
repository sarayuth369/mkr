import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/markets/data/market_data_config.dart';
import 'package:mkr/features/markets/data/symbol_mapping.dart';

void main() {
  const mapper = SymbolMapper();

  test('maps a known US stock symbol for both providers', () {
    expect(mapper.toProviderSymbol('AAPL', MarketDataProviderId.twelveData), 'AAPL');
    expect(mapper.toProviderSymbol('AAPL', MarketDataProviderId.alpaca), 'AAPL');
  });

  test('maps gold only for Twelve Data, not Alpaca', () {
    expect(mapper.supports('XAU/USD', MarketDataProviderId.twelveData), isTrue);
    expect(mapper.supports('XAU/USD', MarketDataProviderId.alpaca), isFalse);
  });

  test('maps forex only for Twelve Data, not Alpaca', () {
    expect(mapper.supports('EUR/USD', MarketDataProviderId.twelveData), isTrue);
    expect(mapper.supports('EUR/USD', MarketDataProviderId.alpaca), isFalse);
  });

  test('an unsupported symbol returns null for both providers rather than a guess', () {
    expect(mapper.toProviderSymbol('SET50', MarketDataProviderId.twelveData), isNull);
    expect(mapper.toProviderSymbol('SET50', MarketDataProviderId.alpaca), isNull);
  });

  test('crypto maps to a slash pair for both providers', () {
    expect(mapper.toProviderSymbol('BTC', MarketDataProviderId.twelveData), 'BTC/USD');
    expect(mapper.toProviderSymbol('BTC', MarketDataProviderId.alpaca), 'BTC/USD');
  });
}
