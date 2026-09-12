import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/theme/app_theme.dart';
import 'package:mkr/core/widgets/market_card.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_quote.dart';

void main() {
  testWidgets('MarketCard never overflows even with an extreme change value', (tester) async {
    const quote = MarketQuote(
      symbol: 'DJI',
      name: 'Dow Jones Industrial Average',
      assetClass: AssetClass.indices,
      price: 43120.50,
      changeAbs: -12345.67,
      changePct: -1234.56,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(
          body: SizedBox(
            height: 98,
            child: MarketCard(quote: quote),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
  });

  testWidgets('featured MarketCard with a sparkline never overflows', (tester) async {
    const quote = MarketQuote(
      symbol: 'BTC',
      name: 'Bitcoin',
      assetClass: AssetClass.crypto,
      price: 96420.00,
      changeAbs: 1840.00,
      changePct: 999.99,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: SizedBox(
            height: 128,
            child: MarketCard(
              quote: quote,
              featured: true,
              sparkline: const [1, 2, 1.5, 3, 2.5, 4],
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
  });
}
