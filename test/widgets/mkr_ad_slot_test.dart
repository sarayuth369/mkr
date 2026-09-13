import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/ads/data/mock_ad_service.dart';
import 'package:mkr/features/ads/domain/ad_config.dart';
import 'package:mkr/features/ads/domain/ad_service.dart';
import 'package:mkr/features/ads/presentation/widgets/mkr_ad_slot.dart';
import 'package:mkr/features/billing/application/entitlement_controller.dart';
import 'package:mkr/features/billing/domain/billing_repository.dart';
import 'package:mkr/features/billing/domain/entitlement.dart';
import 'package:mkr/features/billing/domain/product.dart';
import 'package:mkr/l10n/generated/app_localizations.dart';
import 'package:provider/provider.dart';

class _FakeBillingRepository implements BillingRepository {
  _FakeBillingRepository(this.tier);
  final PremiumTier tier;

  @override
  Future<PremiumTier> getCurrentTier() async => tier;

  @override
  Future<PremiumTier> purchase(Product product) async => tier;

  @override
  Future<PremiumTier> restore() async => tier;
}

Widget _harness({
  required Widget child,
  required PremiumTier tier,
  AdConfig config = const AdConfig(
    enabled: true,
    topBannerEnabled: true,
    bottomBannerEnabled: true,
    appOpenEnabled: true,
    testMode: true,
    androidBannerAdUnitId: 'test-banner',
    androidAppOpenAdUnitId: 'test-app-open',
  ),
}) {
  return MultiProvider(
    providers: [
      Provider<AdConfig>.value(value: config),
      Provider<AdService>(create: (_) => MockAdService()),
      ChangeNotifierProvider(create: (_) => EntitlementController(_FakeBillingRepository(tier))),
    ],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: child),
    ),
  );
}

void main() {
  testWidgets('MkrTopBannerAd renders a banner for a free user', (tester) async {
    await tester.pumpWidget(_harness(child: const MkrTopBannerAd(), tier: PremiumTier.free));
    await tester.pumpAndSettle();
    expect(find.byType(MkrTopBannerAd), findsOneWidget);
    expect(find.text('Test ad · Placeholder'), findsOneWidget);
  });

  testWidgets('MkrTopBannerAd renders nothing for a premium (ad-free) user', (tester) async {
    await tester.pumpWidget(_harness(child: const MkrTopBannerAd(), tier: PremiumTier.pro));
    await tester.pumpAndSettle();
    expect(find.text('Test ad · Placeholder'), findsNothing);
  });

  testWidgets('MkrBottomBannerAd renders nothing when the ad system is globally disabled', (tester) async {
    await tester.pumpWidget(_harness(
      child: const MkrBottomBannerAd(),
      tier: PremiumTier.free,
      config: const AdConfig(
        enabled: false,
        topBannerEnabled: true,
        bottomBannerEnabled: true,
        appOpenEnabled: true,
        testMode: true,
        androidBannerAdUnitId: 'test-banner',
        androidAppOpenAdUnitId: 'test-app-open',
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Test ad · Placeholder'), findsNothing);
  });

  testWidgets('MkrBottomBannerAd renders nothing when only the bottom slot is disabled', (tester) async {
    await tester.pumpWidget(_harness(
      child: const MkrBottomBannerAd(),
      tier: PremiumTier.free,
      config: const AdConfig(
        enabled: true,
        topBannerEnabled: true,
        bottomBannerEnabled: false,
        appOpenEnabled: true,
        testMode: true,
        androidBannerAdUnitId: 'test-banner',
        androidAppOpenAdUnitId: 'test-app-open',
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Test ad · Placeholder'), findsNothing);
  });

  testWidgets('MkrAdBody lays out a fixed-height top ad above expanded content without overflow', (tester) async {
    await tester.pumpWidget(_harness(
      child: const MkrAdBody(child: Center(child: Text('content'))),
      tier: PremiumTier.free,
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('content'), findsOneWidget);
    expect(find.text('Test ad · Placeholder'), findsOneWidget);
  });
}
