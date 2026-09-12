import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mkr/app/app.dart';
import 'package:mkr/core/persistence/app_local_store.dart';

void main() {
  testWidgets('MKR boots past onboarding and navigates every bottom nav tab', (tester) async {
    SharedPreferences.setMockInitialValues({'onboarding_complete': true});
    final store = await AppLocalStore.create();

    await tester.pumpWidget(MkrApp(store: store));
    await tester.pumpAndSettle();

    expect(find.text('MKR'), findsWidgets);

    for (final label in ['Markets', 'Watchlist', 'Alerts', 'Settings', 'Home']) {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    // Unmount so timers (e.g. AlertsController's periodic evaluator) are
    // disposed before the test framework checks for pending timers.
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
