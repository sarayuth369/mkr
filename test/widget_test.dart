import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mkr/app/app.dart';
import 'package:mkr/core/persistence/app_local_store.dart';
import 'package:mkr/features/markets/data/mock_market_service.dart';
import 'package:mkr/features/markets/domain/market_service.dart';

/// 2026-09-15 hardening task: these smoke tests exercise navigation/UI
/// structure, not live real-mode network behavior (that's covered by the
/// dedicated unit tests in test/logic/) - an explicit [MockMarketService]
/// keeps them deterministic and network-free regardless of
/// `MarketDataConfig`'s environment-derived default, which is otherwise
/// "real" during a plain `flutter test` run.
MarketService _testMarketService() => MockMarketService();

/// The App Open ad placeholder shows automatically on cold start (see
/// [AppOpenAdHost]) — dismiss it first, the way a real user would, before
/// asserting on or interacting with anything underneath it.
Future<void> _dismissAppOpenAdIfShown(WidgetTester tester) async {
  final closeButton = find.text('Close');
  if (closeButton.evaluate().isNotEmpty) {
    await tester.tap(closeButton);
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets('MKR boots past onboarding and navigates every bottom nav tab', (tester) async {
    SharedPreferences.setMockInitialValues({'onboarding_complete': true});
    final store = await AppLocalStore.create();

    await tester.pumpWidget(MkrApp(store: store, marketService: _testMarketService()));
    await tester.pumpAndSettle();
    await _dismissAppOpenAdIfShown(tester);

    expect(find.text('Market Radar'), findsWidgets);

    for (final label in ['Markets', 'Watchlist', 'Alerts', 'Settings', 'Home']) {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    // Unmount so timers (e.g. AlertsController's periodic evaluator) are
    // disposed before the test framework checks for pending timers.
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('Settings subscription card opens the Premium paywall', (tester) async {
    SharedPreferences.setMockInitialValues({'onboarding_complete': true});
    final store = await AppLocalStore.create();

    await tester.pumpWidget(MkrApp(store: store, marketService: _testMarketService()));
    await tester.pumpAndSettle();
    await _dismissAppOpenAdIfShown(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    // Free-tier default: the subscription card reads "Unlock MKR Pro".
    expect(find.text('Unlock MKR Pro'), findsOneWidget);
    await tester.tap(find.text('Unlock MKR Pro'));
    await tester.pumpAndSettle();

    expect(find.text('Unlock the full MKR experience'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
