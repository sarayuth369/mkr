import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/ads/domain/app_open_ad_policy.dart';

void main() {
  const policy = AppOpenAdPolicy(minInterval: Duration(minutes: 4));
  final now = DateTime(2026, 1, 1, 12);

  test('can show on cold start when loaded and never shown before', () {
    expect(
      policy.canShow(appOpenEnabled: true, isPremium: false, adLoaded: true, isShowingAd: false, lastShownAt: null, now: now),
      isTrue,
    );
  });

  test('cannot show when disabled', () {
    expect(
      policy.canShow(appOpenEnabled: false, isPremium: false, adLoaded: true, isShowingAd: false, lastShownAt: null, now: now),
      isFalse,
    );
  });

  test('cannot show for a premium (ad-free) user', () {
    expect(
      policy.canShow(appOpenEnabled: true, isPremium: true, adLoaded: true, isShowingAd: false, lastShownAt: null, now: now),
      isFalse,
    );
  });

  test('cannot show when no ad is loaded', () {
    expect(
      policy.canShow(appOpenEnabled: true, isPremium: false, adLoaded: false, isShowingAd: false, lastShownAt: null, now: now),
      isFalse,
    );
  });

  test('cannot show a second ad while one is already showing (no duplicate shows)', () {
    expect(
      policy.canShow(appOpenEnabled: true, isPremium: false, adLoaded: true, isShowingAd: true, lastShownAt: null, now: now),
      isFalse,
    );
  });

  test('cannot show again within the minimum interval after the last show', () {
    final lastShown = now.subtract(const Duration(minutes: 1));
    expect(
      policy.canShow(appOpenEnabled: true, isPremium: false, adLoaded: true, isShowingAd: false, lastShownAt: lastShown, now: now),
      isFalse,
    );
  });

  test('can show again once the minimum interval has elapsed', () {
    final lastShown = now.subtract(const Duration(minutes: 5));
    expect(
      policy.canShow(appOpenEnabled: true, isPremium: false, adLoaded: true, isShowingAd: false, lastShownAt: lastShown, now: now),
      isTrue,
    );
  });
}
