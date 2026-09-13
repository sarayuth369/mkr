import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/ads/application/app_open_ad_manager.dart';
import 'package:mkr/features/ads/domain/ad_config.dart';
import 'package:mkr/features/ads/domain/ad_service.dart';

class _FakeAdService implements AdService {
  int loadCalls = 0;
  int showCalls = 0;
  bool loadResult = true;

  @override
  Future<bool> loadAppOpenAd() async {
    loadCalls++;
    return loadResult;
  }

  @override
  Future<void> showAppOpenAd(BuildContext context) async {
    showCalls++;
  }

  @override
  Widget buildBanner(BuildContext context) => const SizedBox.shrink();

  @override
  Future<void> maybeShowInterstitial(BuildContext context, {required String trigger}) async {}
}

const _config = AdConfig(
  enabled: true,
  topBannerEnabled: true,
  bottomBannerEnabled: true,
  appOpenEnabled: true,
  testMode: true,
  androidBannerAdUnitId: 'test-banner',
  androidAppOpenAdUnitId: 'test-app-open',
);

void main() {
  testWidgets('onAppForeground loads then shows once eligible', (tester) async {
    final adService = _FakeAdService();
    final manager = AppOpenAdManager(adService: adService, config: _config);
    late BuildContext capturedContext;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      capturedContext = context;
      return const SizedBox();
    })));

    await manager.onAppForeground(capturedContext, isPremium: false);

    // 2 loads: the initial preload, plus the "load the next one immediately
    // after showing" reload Google recommends doing right after a show.
    expect(adService.loadCalls, 2);
    expect(adService.showCalls, 1);
  });

  testWidgets('does not show a duplicate ad immediately after the last one (frequency cap)', (tester) async {
    final adService = _FakeAdService();
    final manager = AppOpenAdManager(adService: adService, config: _config);
    late BuildContext capturedContext;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      capturedContext = context;
      return const SizedBox();
    })));

    await manager.onAppForeground(capturedContext, isPremium: false);
    await manager.onAppForeground(capturedContext, isPremium: false);

    expect(adService.showCalls, 1);
  });

  testWidgets('never shows for a premium (ad-free) user', (tester) async {
    final adService = _FakeAdService();
    final manager = AppOpenAdManager(adService: adService, config: _config);
    late BuildContext capturedContext;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      capturedContext = context;
      return const SizedBox();
    })));

    await manager.onAppForeground(capturedContext, isPremium: true);

    expect(adService.showCalls, 0);
  });

  testWidgets('never shows when App Open ads are disabled in config', (tester) async {
    final adService = _FakeAdService();
    final manager = AppOpenAdManager(
      adService: adService,
      config: const AdConfig(
        enabled: true,
        topBannerEnabled: true,
        bottomBannerEnabled: true,
        appOpenEnabled: false,
        testMode: true,
        androidBannerAdUnitId: 'test-banner',
        androidAppOpenAdUnitId: 'test-app-open',
      ),
    );
    late BuildContext capturedContext;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      capturedContext = context;
      return const SizedBox();
    })));

    await manager.onAppForeground(capturedContext, isPremium: false);

    expect(adService.showCalls, 0);
  });

  testWidgets('a failed load means no show, but the app is not blocked', (tester) async {
    final adService = _FakeAdService()..loadResult = false;
    final manager = AppOpenAdManager(adService: adService, config: _config);
    late BuildContext capturedContext;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      capturedContext = context;
      return const SizedBox();
    })));

    await manager.onAppForeground(capturedContext, isPremium: false);

    expect(adService.showCalls, 0);
    expect(manager.canShow(isPremium: false), isFalse);
  });
}
