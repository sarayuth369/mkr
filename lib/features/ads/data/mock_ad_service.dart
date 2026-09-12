import 'package:flutter/material.dart';

import '../../../l10n/generated/app_localizations.dart';
import '../domain/ad_service.dart';

/// Renders clearly-labeled placeholders instead of loading a real ad SDK —
/// avoids a native Gradle dependency while still exercising the full call
/// pattern the real AdMob integration will use later. Uses Google's
/// published test ad unit IDs as a placeholder reference only (no network
/// call is actually made by this implementation).
class MockAdService implements AdService {
  static const testBannerUnitId = 'ca-app-pub-3940256099942544/6300978111';
  static const testInterstitialUnitId = 'ca-app-pub-3940256099942544/1033173712';

  static const int _interstitialEveryNTriggers = 3;
  final Map<String, int> _triggerCounts = {};

  @override
  Widget buildBanner(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
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
  Future<void> maybeShowInterstitial(BuildContext context, {required String trigger}) async {
    final count = (_triggerCounts[trigger] ?? 0) + 1;
    _triggerCounts[trigger] = count;
    if (count % _interstitialEveryNTriggers != 0) return;
    if (!context.mounted) return;
    final l10n = AppLocalizations.of(context);

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
}
