import 'package:flutter/widgets.dart';

/// [GoogleMobileAdsService] (2026-09-17 AdMob + Billing task) is the real
/// `google_mobile_ads`-backed implementation of this interface;
/// [MockAdService] remains for demo mode and widget tests. Test ad unit
/// IDs are used during development ([AdConfig.testMode]); production IDs
/// come from [AdConfig] and are never hardcoded outside it. Every call
/// site must check entitlement first — premium users never see ad calls
/// at all.
abstract class AdService {
  Widget buildBanner(BuildContext context);

  Future<void> maybeShowInterstitial(BuildContext context, {required String trigger});

  /// Preloads an App Open ad. Returns `true` once one is ready to show;
  /// `false` on failure — callers must treat that as "no ad this time" and
  /// continue into the app normally, never block startup waiting on it.
  Future<bool> loadAppOpenAd();

  /// Displays the App Open ad loaded by [loadAppOpenAd]. Only ever called
  /// by [AppOpenAdManager] after its own eligibility checks pass.
  Future<void> showAppOpenAd(BuildContext context);

  /// Releases any native ad resources (loaded app-open/interstitial ads,
  /// any pending loads) — the real implementation must not leak native ad
  /// objects across the app's lifetime. A no-op for [MockAdService].
  void dispose();
}
