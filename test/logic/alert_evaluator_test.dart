import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_quote.dart';
import 'package:mkr/domain/market_trend.dart';
import 'package:mkr/features/alerts/domain/alert.dart';
import 'package:mkr/features/alerts/domain/alert_evaluator.dart';

void main() {
  const btc = MarketQuote(
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: AssetClass.crypto,
    price: 96000,
    changeAbs: 4000,
    changePct: 4.3,
  );

  group('price alerts', () {
    test('fires when price is above target', () {
      final alert = Alert.price(id: '1', symbol: 'BTC', target: 95000, direction: PriceDirection.above);
      final result = AlertEvaluator.evaluate(alerts: [alert], quotes: {'BTC': btc});
      expect(result, contains('1'));
    });

    test('does not fire when price is below the "above" target', () {
      final alert = Alert.price(id: '1', symbol: 'BTC', target: 200000, direction: PriceDirection.above);
      final result = AlertEvaluator.evaluate(alerts: [alert], quotes: {'BTC': btc});
      expect(result, isEmpty);
    });

    test('fires when price is below target for "below" direction', () {
      final alert = Alert.price(id: '1', symbol: 'BTC', target: 200000, direction: PriceDirection.below);
      final result = AlertEvaluator.evaluate(alerts: [alert], quotes: {'BTC': btc});
      expect(result, contains('1'));
    });
  });

  group('percentage alerts', () {
    test('fires when absolute change exceeds threshold', () {
      final alert = Alert.percentage(id: '2', symbol: 'BTC', thresholdPct: 3);
      final result = AlertEvaluator.evaluate(alerts: [alert], quotes: {'BTC': btc});
      expect(result, contains('2'));
    });

    test('does not fire when change is under threshold', () {
      final alert = Alert.percentage(id: '2', symbol: 'BTC', thresholdPct: 10);
      final result = AlertEvaluator.evaluate(alerts: [alert], quotes: {'BTC': btc});
      expect(result, isEmpty);
    });
  });

  group('event alerts', () {
    test('fires when a matching event title exists today', () {
      final alert = Alert.event(id: '3', eventKeyword: 'CPI');
      final result = AlertEvaluator.evaluate(
        alerts: [alert],
        todaysEventTitles: ['US CPI (YoY)'],
      );
      expect(result, contains('3'));
    });

    test('does not fire when no matching event exists', () {
      final alert = Alert.event(id: '3', eventKeyword: 'FOMC');
      final result = AlertEvaluator.evaluate(
        alerts: [alert],
        todaysEventTitles: ['US CPI (YoY)'],
      );
      expect(result, isEmpty);
    });
  });

  group('radar alerts', () {
    test('fires on the exact matching transition', () {
      final alert = Alert.radar(id: '4', symbol: 'XAU/USD', transition: RadarTransition.neutralToBullish);
      final result = AlertEvaluator.evaluate(
        alerts: [alert],
        previousTrends: {'XAU/USD': MarketTrend.neutral},
        currentTrends: {'XAU/USD': MarketTrend.bullish},
      );
      expect(result, contains('4'));
    });

    test('does not fire on a different transition', () {
      final alert = Alert.radar(id: '4', symbol: 'XAU/USD', transition: RadarTransition.neutralToBullish);
      final result = AlertEvaluator.evaluate(
        alerts: [alert],
        previousTrends: {'XAU/USD': MarketTrend.bullish},
        currentTrends: {'XAU/USD': MarketTrend.neutral},
      );
      expect(result, isEmpty);
    });
  });

  test('disabled alerts never fire', () {
    final alert = Alert.price(id: '5', symbol: 'BTC', target: 1, direction: PriceDirection.above)
        .copyWith(isEnabled: false);
    final result = AlertEvaluator.evaluate(alerts: [alert], quotes: {'BTC': btc});
    expect(result, isEmpty);
  });
}
