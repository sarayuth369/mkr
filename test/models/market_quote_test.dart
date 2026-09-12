import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_quote.dart';

void main() {
  test('two quotes with the same symbol/price/change are equal', () {
    const a = MarketQuote(
      symbol: 'BTC',
      name: 'Bitcoin',
      assetClass: AssetClass.crypto,
      price: 100,
      changeAbs: 1,
      changePct: 1,
    );
    const b = MarketQuote(
      symbol: 'BTC',
      name: 'Bitcoin',
      assetClass: AssetClass.crypto,
      price: 100,
      changeAbs: 1,
      changePct: 1,
    );
    expect(a, equals(b));
    expect(a.hashCode, equals(b.hashCode));
  });

  test('isUp is true when changePct is zero or positive', () {
    const flat = MarketQuote(
      symbol: 'X',
      name: 'X',
      assetClass: AssetClass.forex,
      price: 1,
      changeAbs: 0,
      changePct: 0,
    );
    const down = MarketQuote(
      symbol: 'X',
      name: 'X',
      assetClass: AssetClass.forex,
      price: 1,
      changeAbs: -0.1,
      changePct: -0.5,
    );
    expect(flat.isUp, isTrue);
    expect(down.isUp, isFalse);
  });

  test('copyWith overrides only the given fields', () {
    const original = MarketQuote(
      symbol: 'ETH',
      name: 'Ethereum',
      assetClass: AssetClass.crypto,
      price: 3000,
      changeAbs: 10,
      changePct: 0.3,
    );
    final updated = original.copyWith(price: 3100);
    expect(updated.price, 3100);
    expect(updated.symbol, 'ETH');
    expect(updated.name, 'Ethereum');
  });
}
