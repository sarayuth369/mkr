/// Non-secret, build-time ad configuration. AdMob App IDs and ad unit IDs
/// are not credentials — Google's own docs require embedding them directly
/// in the app/manifest — so hardcoding the real MKR values below is correct
/// and not a secret-exposure concern; nothing here can charge money or
/// authenticate as MKR the way an API key/service-account key could.
///
/// 2026-09-17 AdMob + Billing task: [testMode] is the one safety switch.
/// While `true` (the default — safe for local runs/CI, where nobody should
/// accidentally request real ad inventory), [androidBannerAdUnitId]/
/// [androidAppOpenAdUnitId] always resolve to Google's own published TEST
/// ad unit IDs regardless of what's configured, never the real ones. The
/// operator flips `MKR_ADS_TEST_MODE=false` only for the actual Closed
/// Testing/production release build, at which point the real MKR ad unit
/// IDs below (provided directly by the operator) are what gets requested.
/// The AdMob Application ID itself ([androidAppId]) is not test/prod-gated
/// this way — Google's SDK requires one real App ID in the manifest at all
/// times, and requests test ads via test AD UNIT ids while still using the
/// real App ID, so the real MKR App ID is always the default.
///
/// [enabled] defaults `true` so the product owner can see and verify
/// top/bottom placement, scroll behavior and safe-area handling out of the
/// box — flip to `false` to preview the app with ads fully off without
/// touching any screen.
class AdConfig {
  const AdConfig({
    required this.enabled,
    required this.topBannerEnabled,
    required this.bottomBannerEnabled,
    required this.appOpenEnabled,
    required this.testMode,
    required this.androidAppId,
    required String androidBannerAdUnitId,
    required String androidAppOpenAdUnitId,
  })  : _androidBannerAdUnitId = androidBannerAdUnitId,
        _androidAppOpenAdUnitId = androidAppOpenAdUnitId;

  final bool enabled;
  final bool topBannerEnabled;
  final bool bottomBannerEnabled;
  final bool appOpenEnabled;
  final bool testMode;

  /// The real MKR AdMob Application ID (matches the value hardcoded in
  /// `android/app/src/main/AndroidManifest.xml`'s
  /// `com.google.android.gms.ads.APPLICATION_ID` meta-data — kept here too
  /// purely for admin/diagnostic display, never read by the native SDK
  /// from Dart).
  final String androidAppId;

  final String _androidBannerAdUnitId;
  final String _androidAppOpenAdUnitId;

  /// Google's own published test ad unit IDs (developers.google.com/admob/android/test-ads)
  /// — safe to request unconditionally, never served from real inventory,
  /// never billed. Used whenever [testMode] is on, and by [MockAdService]/
  /// widget tests regardless of [testMode].
  static const testBannerUnitId = 'ca-app-pub-3940256099942544/6300978111';
  static const testInterstitialUnitId = 'ca-app-pub-3940256099942544/1033173712';
  static const testAppOpenUnitId = 'ca-app-pub-3940256099942544/9257395921';
  static const testAppId = 'ca-app-pub-3940256099942544~3347511713';

  String get androidBannerAdUnitId => testMode ? testBannerUnitId : _androidBannerAdUnitId;
  String get androidAppOpenAdUnitId => testMode ? testAppOpenUnitId : _androidAppOpenAdUnitId;

  static const _enabledDefine = bool.fromEnvironment('MKR_ADS_ENABLED', defaultValue: true);
  static const _testModeDefine = bool.fromEnvironment('MKR_ADS_TEST_MODE', defaultValue: true);
  static const _topDefine = bool.fromEnvironment('MKR_ADS_TOP_BANNER_ENABLED', defaultValue: true);
  static const _bottomDefine = bool.fromEnvironment('MKR_ADS_BOTTOM_BANNER_ENABLED', defaultValue: true);
  static const _appOpenDefine = bool.fromEnvironment('MKR_ADS_APP_OPEN_ENABLED', defaultValue: true);

  // Real MKR production values, provided directly by the operator
  // (2026-09-17 AdMob + Billing task) — safe to hardcode as defaults per
  // this file's own doc comment (App/ad-unit IDs are not credentials).
  // Overridable via --dart-define for a different environment if ever
  // needed, but there is currently only one MKR AdMob account/app.
  static const _appIdDefine = String.fromEnvironment('MKR_ADMOB_APP_ID', defaultValue: 'ca-app-pub-1918372113970166~1172227772');
  static const _bannerUnitDefine = String.fromEnvironment('MKR_ADS_ANDROID_BANNER_UNIT_ID', defaultValue: 'ca-app-pub-1918372113970166/4629836064');
  static const _appOpenUnitDefine = String.fromEnvironment('MKR_ADS_ANDROID_APP_OPEN_UNIT_ID', defaultValue: 'ca-app-pub-1918372113970166/7862951171');

  static AdConfig fromEnvironment() => const AdConfig(
        enabled: _enabledDefine,
        topBannerEnabled: _topDefine,
        bottomBannerEnabled: _bottomDefine,
        appOpenEnabled: _appOpenDefine,
        testMode: _testModeDefine,
        androidAppId: _appIdDefine,
        androidBannerAdUnitId: _bannerUnitDefine,
        androidAppOpenAdUnitId: _appOpenUnitDefine,
      );
}
