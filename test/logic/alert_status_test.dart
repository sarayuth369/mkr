import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/alert_card.dart';
import 'package:mkr/features/alerts/domain/alert.dart';

void main() {
  test('an enabled alert that has never triggered is active', () {
    final alert = Alert.price(id: '1', symbol: 'BTC', target: 100000, direction: PriceDirection.above);
    expect(alertStatusOf(alert), AlertStatus.active);
  });

  test('an enabled alert with a lastTriggeredAt is triggered', () {
    final alert = Alert.price(id: '1', symbol: 'BTC', target: 100000, direction: PriceDirection.above)
        .copyWith(lastTriggeredAt: DateTime.now());
    expect(alertStatusOf(alert), AlertStatus.triggered);
  });

  test('a disabled alert is paused regardless of trigger history', () {
    final neverTriggered = Alert.price(id: '1', symbol: 'BTC', target: 100000, direction: PriceDirection.above)
        .copyWith(isEnabled: false);
    expect(alertStatusOf(neverTriggered), AlertStatus.paused);

    final previouslyTriggered =
        Alert.price(id: '2', symbol: 'BTC', target: 100000, direction: PriceDirection.above)
            .copyWith(isEnabled: false, lastTriggeredAt: DateTime.now());
    expect(alertStatusOf(previouslyTriggered), AlertStatus.paused);
  });
}
