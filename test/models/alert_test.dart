import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/alerts/domain/alert.dart';

void main() {
  test('price alert round-trips through JSON', () {
    final alert = Alert.price(id: '1', symbol: 'NVDA', target: 150, direction: PriceDirection.below);
    final restored = Alert.fromJson(alert.toJson());

    expect(restored.id, alert.id);
    expect(restored.type, AlertType.price);
    expect(restored.symbol, 'NVDA');
    expect(restored.priceTarget, 150);
    expect(restored.priceDirection, PriceDirection.below);
  });

  test('radar alert round-trips through JSON', () {
    final alert = Alert.radar(id: '2', symbol: 'XAU/USD', transition: RadarTransition.neutralToBullish);
    final restored = Alert.fromJson(alert.toJson());

    expect(restored.type, AlertType.radar);
    expect(restored.radarTransition, RadarTransition.neutralToBullish);
  });

  test('summary formats each alert type readably', () {
    final price = Alert.price(id: '1', symbol: 'BTC', target: 120000, direction: PriceDirection.above);
    expect(price.summary, contains('BTC'));
    expect(price.summary, contains('120000'));

    final pct = Alert.percentage(id: '2', symbol: 'BTC', thresholdPct: 5);
    expect(pct.summary, contains('±5'));

    final event = Alert.event(id: '3', eventKeyword: 'FOMC');
    expect(event.summary, contains('FOMC'));
  });

  test('copyWith toggles isEnabled without touching other fields', () {
    final alert = Alert.percentage(id: '4', symbol: 'NVDA', thresholdPct: 3);
    final disabled = alert.copyWith(isEnabled: false);
    expect(disabled.isEnabled, isFalse);
    expect(disabled.symbol, alert.symbol);
    expect(disabled.percentageThreshold, alert.percentageThreshold);
  });
}
