import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher_platform_interface/link.dart' show LinkDelegate;
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:mkr/app/app.dart';
import 'package:mkr/core/persistence/app_local_store.dart';
import 'package:mkr/features/ads/data/mock_ad_service.dart';
import 'package:mkr/features/billing/data/mock_billing_repository.dart';
import 'package:mkr/features/markets/data/mock_market_service.dart';
import 'package:mkr/features/markets/domain/market_service.dart';

/// 2026-09-17 Hosted Privacy Policy task - a controllable fake so tests can
/// assert exactly which URL Settings tries to open, and simulate a launch
/// failure (no browser available) without touching a real platform channel.
class _FakeUrlLauncherPlatform extends UrlLauncherPlatform {
  _FakeUrlLauncherPlatform({this.launchSucceeds = true});

  final bool launchSucceeds;
  String? lastLaunchedUrl;

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => launchSucceeds;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    lastLaunchedUrl = url;
    return launchSucceeds;
  }
}

/// 2026-09-15 hardening task: these smoke tests exercise navigation/UI
/// structure, not live real-mode network behavior (that's covered by the
/// dedicated unit tests in test/logic/) - an explicit [MockMarketService]
/// keeps them deterministic and network-free regardless of
/// `MarketDataConfig`'s environment-derived default, which is otherwise
/// "real" during a plain `flutter test` run.
MarketService _testMarketService() => MockMarketService();

/// 2026-09-17 AdMob + Billing task: `defaultTargetPlatform` defaults to
/// `TargetPlatform.android` inside Flutter's own test binding regardless
/// of the host OS, so without explicit overrides `MkrApp` would construct
/// the REAL `GoogleMobileAdsService`/`PlayBillingRepository` (real
/// platform-channel calls with no native test harness behind them) for
/// every widget test - confirmed live: every test in this file hung on
/// `pumpAndSettle` before these overrides were added. Same seam/reasoning
/// as `_testMarketService` above.
Widget _testApp({required AppLocalStore store, required MarketService marketService}) => MkrApp(
      store: store,
      marketService: marketService,
      adService: MockAdService(),
      billingRepository: MockBillingRepository(store),
    );

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

    await tester.pumpWidget(_testApp(store: store, marketService: _testMarketService()));
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

    await tester.pumpWidget(_testApp(store: store, marketService: _testMarketService()));
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

  testWidgets('Settings > Privacy Policy opens the real hosted URL when a browser is available', (tester) async {
    final fakeLauncher = _FakeUrlLauncherPlatform();
    UrlLauncherPlatform.instance = fakeLauncher;
    SharedPreferences.setMockInitialValues({'onboarding_complete': true});
    final store = await AppLocalStore.create();

    await tester.pumpWidget(_testApp(store: store, marketService: _testMarketService()));
    await tester.pumpAndSettle();
    await _dismissAppOpenAdIfShown(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    // "Privacy Policy" sits in the Legal section, below the fold in a
    // plain (non-lazy-built) ListView - Flutter's Sliver machinery still
    // only builds items within the viewport/cache extent, so it must be
    // scrolled into view before it exists in the element tree to tap.
    await tester.dragUntilVisible(find.text('Privacy Policy'), find.byType(ListView), const Offset(0, -200));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Privacy Policy'));
    await tester.pumpAndSettle();

    expect(fakeLauncher.lastLaunchedUrl, 'https://mkr-backend.biz2success.workers.dev/privacy');
    // The real hosted page opened externally - the in-app fallback text
    // screen must NOT have been pushed on top.
    expect(find.textContaining('MKR Privacy Notice'), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('Settings > Privacy Policy falls back to the in-app notice when the URL cannot be opened', (tester) async {
    UrlLauncherPlatform.instance = _FakeUrlLauncherPlatform(launchSucceeds: false);
    SharedPreferences.setMockInitialValues({'onboarding_complete': true});
    final store = await AppLocalStore.create();

    await tester.pumpWidget(_testApp(store: store, marketService: _testMarketService()));
    await tester.pumpAndSettle();
    await _dismissAppOpenAdIfShown(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(find.text('Privacy Policy'), find.byType(ListView), const Offset(0, -200));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Privacy Policy'));
    await tester.pumpAndSettle();

    // Never leaves the user with neither the real page nor a fallback.
    expect(find.textContaining('MKR Privacy Notice'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
