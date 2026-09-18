import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/ads/domain/ad_config.dart';

void main() {
  test('fromEnvironment defaults: ads on (placeholder mode), test mode on, Google test unit IDs', () {
    final config = AdConfig.fromEnvironment();
    expect(config.enabled, isTrue);
    expect(config.topBannerEnabled, isTrue);
    expect(config.bottomBannerEnabled, isTrue);
    expect(config.appOpenEnabled, isTrue);
    expect(config.testMode, isTrue);
    expect(config.androidBannerAdUnitId, AdConfig.testBannerUnitId);
    expect(config.androidAppOpenAdUnitId, AdConfig.testAppOpenUnitId);
  });

  test('real MKR production ad unit IDs are configured but never used while testMode is on', () {
    // 2026-09-17 AdMob + Billing task: fromEnvironment() bakes in the real
    // operator-provided IDs as its production defaults - this only
    // confirms testMode's safety guarantee (never served from real
    // inventory unless explicitly turned off), not that the real values
    // are absent from the app entirely.
    final config = AdConfig.fromEnvironment();
    expect(config.androidAppId, 'ca-app-pub-1918372113970166~1172227772');
    const withTestModeOff = AdConfig(
      enabled: true,
      topBannerEnabled: true,
      bottomBannerEnabled: true,
      appOpenEnabled: true,
      testMode: false,
      androidAppId: 'ca-app-pub-1918372113970166~1172227772',
      androidBannerAdUnitId: 'ca-app-pub-1918372113970166/4629836064',
      androidAppOpenAdUnitId: 'ca-app-pub-1918372113970166/7862951171',
    );
    expect(withTestModeOff.androidBannerAdUnitId, 'ca-app-pub-1918372113970166/4629836064');
    expect(config.androidBannerAdUnitId, isNot(withTestModeOff.androidBannerAdUnitId));
  });

  test('never defaults to a real-looking production ad unit id', () {
    final config = AdConfig.fromEnvironment();
    // Google's published test IDs all share this app id prefix.
    expect(config.androidBannerAdUnitId, startsWith('ca-app-pub-3940256099942544/'));
    expect(config.androidAppOpenAdUnitId, startsWith('ca-app-pub-3940256099942544/'));
  });
}
