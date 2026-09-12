import 'package:flutter/material.dart';

import '../domain/ad_service.dart';

/// Renders clearly-labeled placeholders instead of loading a real ad SDK —
/// keeps Phase 1 free of native Gradle dependencies while still exercising
/// the full call pattern the real AdMob integration will use later.
/// Uses Google's published test ad unit IDs as a placeholder reference only
/// (no network call is actually made in Phase 1).
class MockAdService implements AdService {
  static const testBannerUnitId = 'ca-app-pub-3940256099942544/6300978111';
  static const testInterstitialUnitId = 'ca-app-pub-3940256099942544/1033173712';

  static const int _interstitialEveryNTriggers = 3;
  final Map<String, int> _triggerCounts = {};

  @override
  Widget buildBanner(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      height: 50,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        'TEST AD · Banner placeholder',
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

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('TEST AD'),
        content: const Text('Interstitial ad placeholder (Phase 1 mock — no real SDK loaded).'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
        ],
      ),
    );
  }
}
