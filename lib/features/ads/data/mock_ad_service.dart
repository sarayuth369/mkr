import 'package:flutter/material.dart';

import '../../../l10n/generated/app_localizations.dart';
import '../domain/ad_analytics.dart';
import '../domain/ad_service.dart';

/// Renders clearly-labeled placeholders instead of loading a real ad SDK —
/// used for demo mode and widget tests, alongside [GoogleMobileAdsService]
/// (the real implementation, 2026-09-17 AdMob + Billing task). Never
/// actually makes a network call. Google's real test ad unit ID constants
/// now live on [AdConfig] (this class doesn't need them itself).
class MockAdService implements AdService {
  MockAdService({AdAnalytics analytics = const NoopAdAnalytics()}) : _analytics = analytics;

  static const int _interstitialEveryNTriggers = 3;
  final Map<String, int> _triggerCounts = {};
  final AdAnalytics _analytics;

  @override
  Widget buildBanner(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    _analytics.onAdLoaded('banner');
    _analytics.onAdDisplayed('banner');
    // 50dp matches AdMob's standard/adaptive-banner height on a phone in
    // portrait — Phase 3 swaps this Container for a real
    // BannerAdWidget/AnchoredAdaptiveBannerAdSize without the surrounding
    // slot layout (MkrTopBannerAd/MkrBottomBannerAd) needing to change.
    return Container(
      width: double.infinity,
      height: 50,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        l10n.adBannerPlaceholder,
        style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    );
  }

  @override
  Future<bool> loadAppOpenAd() async {
    await Future.delayed(const Duration(milliseconds: 200));
    _analytics.onAdLoaded('appOpen');
    return true;
  }

  @override
  Future<void> showAppOpenAd(BuildContext context) async {
    if (!context.mounted) return;
    final l10n = AppLocalizations.of(context);
    _analytics.onAdDisplayed('appOpen');
    _analytics.onAppOpenShown();

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.adTestAdTitle),
        content: Text(l10n.adAppOpenPlaceholder),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(l10n.close)),
        ],
      ),
    );
  }

  @override
  Future<void> maybeShowInterstitial(BuildContext context, {required String trigger}) async {
    final count = (_triggerCounts[trigger] ?? 0) + 1;
    _triggerCounts[trigger] = count;
    if (count % _interstitialEveryNTriggers != 0) return;
    if (!context.mounted) return;
    final l10n = AppLocalizations.of(context);
    _analytics.onAdDisplayed('interstitial');

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.adTestAdTitle),
        content: Text(l10n.adInterstitialPlaceholder),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(l10n.close)),
        ],
      ),
    );
  }

  @override
  void dispose() {}
}
