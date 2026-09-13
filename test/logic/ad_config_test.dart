import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/ads/data/mock_ad_service.dart';
import 'package:mkr/features/ads/domain/ad_config.dart';

void main() {
  test('fromEnvironment defaults: ads on (placeholder mode), test mode on, Google test unit IDs', () {
    final config = AdConfig.fromEnvironment();
    expect(config.enabled, isTrue);
    expect(config.topBannerEnabled, isTrue);
    expect(config.bottomBannerEnabled, isTrue);
    expect(config.appOpenEnabled, isTrue);
    expect(config.testMode, isTrue);
    expect(config.androidBannerAdUnitId, MockAdService.testBannerUnitId);
    expect(config.androidAppOpenAdUnitId, MockAdService.testAppOpenUnitId);
  });

  test('never defaults to a real-looking production ad unit id', () {
    final config = AdConfig.fromEnvironment();
    // Google's published test IDs all share this app id prefix.
    expect(config.androidBannerAdUnitId, startsWith('ca-app-pub-3940256099942544/'));
    expect(config.androidAppOpenAdUnitId, startsWith('ca-app-pub-3940256099942544/'));
  });
}
