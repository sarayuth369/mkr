import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/ads/domain/ads_eligibility.dart';

void main() {
  test('shows ads when enabled and not premium', () {
    expect(AdsEligibility.shouldShowAds(adsEnabled: true, isPremium: false), isTrue);
  });

  test('premium always removes ads, even when the ad system is enabled', () {
    expect(AdsEligibility.shouldShowAds(adsEnabled: true, isPremium: true), isFalse);
  });

  test('a globally disabled ad system shows no ads even for a free user', () {
    expect(AdsEligibility.shouldShowAds(adsEnabled: false, isPremium: false), isFalse);
  });

  test('disabled and premium together still means no ads', () {
    expect(AdsEligibility.shouldShowAds(adsEnabled: false, isPremium: true), isFalse);
  });
}
