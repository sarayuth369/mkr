import 'package:flutter/widgets.dart';

/// Production path: swap [MockAdService] for a `google_mobile_ads`-backed
/// implementation behind this same interface. Test ad unit IDs are used
/// during development; production IDs must be configurable (not hardcoded).
/// Every call site must check entitlement first — premium users never see
/// ad calls at all.
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
}
