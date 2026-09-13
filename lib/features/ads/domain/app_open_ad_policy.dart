/// Pure frequency-cap decision for App Open ads, isolated from any SDK/
/// Flutter dependency so the "don't show too often" rule is unit-testable
/// without a widget test. [AppOpenAdManager] is the only caller.
class AppOpenAdPolicy {
  const AppOpenAdPolicy({this.minInterval = const Duration(minutes: 4)});

  /// Minimum time between two App Open ad shows — prevents "immediately
  /// after another app-open ad" and repeated showing within a few seconds.
  final Duration minInterval;

  bool canShow({
    required bool appOpenEnabled,
    required bool isPremium,
    required bool adLoaded,
    required bool isShowingAd,
    required DateTime? lastShownAt,
    required DateTime now,
  }) {
    if (!appOpenEnabled || isPremium) return false;
    if (!adLoaded || isShowingAd) return false;
    if (lastShownAt != null && now.difference(lastShownAt) < minInterval) return false;
    return true;
  }
}
