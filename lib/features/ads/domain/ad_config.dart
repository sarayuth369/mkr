import '../data/mock_ad_service.dart';

/// Non-secret, build-time ad configuration — no real AdMob unit IDs belong
/// here or anywhere in source (Phase 3 concern). Every default below points
/// at Google's own published test ad unit IDs, never a production one.
///
/// [enabled] defaults `true` (placeholder mode) rather than `false` so the
/// product owner can see and verify top/bottom placement, scroll behavior
/// and safe-area handling out of the box — flip to `false` to preview the
/// app with ads fully off without touching any screen.
class AdConfig {
  const AdConfig({
    required this.enabled,
    required this.topBannerEnabled,
    required this.bottomBannerEnabled,
    required this.appOpenEnabled,
    required this.testMode,
    required this.androidBannerAdUnitId,
    required this.androidAppOpenAdUnitId,
  });

  final bool enabled;
  final bool topBannerEnabled;
  final bool bottomBannerEnabled;
  final bool appOpenEnabled;

  /// Always `true` until Phase 3 wires a real `google_mobile_ads` build —
  /// nothing in this codebase currently sets it `false`.
  final bool testMode;

  /// Placeholder ad-unit-id config keys for Phase 3 to fill in with real
  /// values via `--dart-define`. Defaulted to Google's published test IDs
  /// (safe to ship, never charge/serve real ads) — never a production ID.
  final String androidBannerAdUnitId;
  final String androidAppOpenAdUnitId;

  static const _enabledDefine = bool.fromEnvironment('MKR_ADS_ENABLED', defaultValue: true);
  static const _testModeDefine = bool.fromEnvironment('MKR_ADS_TEST_MODE', defaultValue: true);
  static const _topDefine = bool.fromEnvironment('MKR_ADS_TOP_BANNER_ENABLED', defaultValue: true);
  static const _bottomDefine = bool.fromEnvironment('MKR_ADS_BOTTOM_BANNER_ENABLED', defaultValue: true);
  static const _appOpenDefine = bool.fromEnvironment('MKR_ADS_APP_OPEN_ENABLED', defaultValue: true);
  static const _bannerUnitDefine = String.fromEnvironment(
    'MKR_ADS_ANDROID_BANNER_UNIT_ID',
    defaultValue: MockAdService.testBannerUnitId,
  );
  static const _appOpenUnitDefine = String.fromEnvironment(
    'MKR_ADS_ANDROID_APP_OPEN_UNIT_ID',
    defaultValue: MockAdService.testAppOpenUnitId,
  );

  static AdConfig fromEnvironment() => const AdConfig(
        enabled: _enabledDefine,
        topBannerEnabled: _topDefine,
        bottomBannerEnabled: _bottomDefine,
        appOpenEnabled: _appOpenDefine,
        testMode: _testModeDefine,
        androidBannerAdUnitId: _bannerUnitDefine,
        androidAppOpenAdUnitId: _appOpenUnitDefine,
      );
}
