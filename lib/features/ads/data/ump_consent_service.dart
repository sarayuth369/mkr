import 'dart:async';

import 'package:google_mobile_ads/google_mobile_ads.dart';

/// 2026-09-17 AdMob + Billing task - Google's User Messaging Platform (UMP)
/// consent flow, required before requesting ads for users where consent
/// applies (EEA/UK/Switzerland under GDPR, and similar regimes elsewhere
/// UMP is configured to cover in the AdMob console). Ships as part of the
/// `google_mobile_ads` package itself - no extra dependency.
///
/// [requestConsentAndCheckIfAdsCanBeRequested] follows Google's own
/// documented flow exactly: request an info update, load+show a consent
/// form ONLY if one is actually required for this user/region, then
/// report [ConsentInformation.canRequestAds] - the single source of truth
/// `GoogleMobileAdsService` checks before ever calling
/// `MobileAds.instance.initialize()`/loading an ad. A failure at any step
/// degrades to "don't request ads yet" rather than crashing startup - the
/// exact same graceful-degradation discipline this app already uses for
/// Firebase/Supabase initialization in `main.dart`.
class UmpConsentService {
  const UmpConsentService();

  Future<bool> requestConsentAndCheckIfAdsCanBeRequested() async {
    final completer = Completer<void>();
    ConsentInformation.instance.requestConsentInfoUpdate(
      ConsentRequestParameters(),
      () => _loadAndShowIfRequired(completer),
      (FormError error) {
        if (!completer.isCompleted) completer.complete();
      },
    );
    await completer.future;
    try {
      return await ConsentInformation.instance.canRequestAds();
    } catch (_) {
      return false;
    }
  }

  void _loadAndShowIfRequired(Completer<void> completer) {
    ConsentForm.loadAndShowConsentFormIfRequired((FormError? formError) {
      if (!completer.isCompleted) completer.complete();
    });
  }

  /// Exposed for a future Settings → Privacy Options entry point (only
  /// needed if `getPrivacyOptionsRequirementStatus()` ever reports
  /// `required` for a real user - not wired to any screen yet since no
  /// call site needed it before this task).
  Future<bool> isPrivacyOptionsFormRequired() async {
    try {
      final status = await ConsentInformation.instance.getPrivacyOptionsRequirementStatus();
      return status == PrivacyOptionsRequirementStatus.required;
    } catch (_) {
      return false;
    }
  }

  Future<void> showPrivacyOptionsForm() {
    final completer = Completer<void>();
    ConsentForm.showPrivacyOptionsForm((FormError? formError) {
      if (!completer.isCompleted) completer.complete();
    });
    return completer.future;
  }
}
