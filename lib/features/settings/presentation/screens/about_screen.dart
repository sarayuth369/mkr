import 'package:flutter/material.dart';

import '../../../../core/app_info.dart' as app_info;
import '../../../../core/constants/disclaimer.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/app_logo_mark.dart';
import '../../../../l10n/generated/app_localizations.dart';

/// Polished, professional About Market Radar page — brand mark + headline,
/// product copy, a feature checklist, the mandated financial disclaimer in
/// a clearly separated section (kept verbatim/English per the original
/// product spec), and a plain footer. No mention of internal development
/// stage anywhere on this screen.
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  static const appVersion = app_info.appVersion;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    final features = [
      l10n.aboutFeatureDashboard,
      l10n.aboutFeatureAiAssistant,
      l10n.aboutFeatureRealtime,
      l10n.aboutFeatureAlerts,
      l10n.aboutFeatureGlobalCoverage,
      l10n.aboutFeaturePremiumTools,
    ];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsAbout)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: Column(
              children: [
                const AppLogoMark(size: 64),
                const SizedBox(height: 12),
                Text(l10n.aboutFooterBrand, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 2),
                Text(
                  l10n.aboutHeadline,
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.aboutParagraph1, style: theme.textTheme.bodyMedium),
                  const SizedBox(height: 12),
                  Text(l10n.aboutParagraph2, style: theme.textTheme.bodyMedium),
                  const SizedBox(height: 12),
                  Text(l10n.aboutParagraph3, style: theme.textTheme.bodyMedium),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final feature in features)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Icon(Icons.check_circle, size: 18, color: context.marketColors.gain),
                          const SizedBox(width: 10),
                          Expanded(child: Text(feature, style: theme.textTheme.bodyMedium)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            color: theme.colorScheme.surfaceContainerHigh,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline, size: 16, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 8),
                      Text(
                        l10n.aboutDisclaimerTitle,
                        style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    Disclaimer.full,
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          Center(
            child: Column(
              children: [
                Text(l10n.aboutFooterBrand, style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  '${l10n.versionLabel} $appVersion',
                  style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
