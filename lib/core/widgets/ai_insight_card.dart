import 'package:flutter/material.dart';

import '../../features/ai/domain/ai_insight.dart';
import '../../l10n/generated/app_localizations.dart';

class AIInsightCard extends StatelessWidget {
  const AIInsightCard({super.key, required this.insight, required this.title});

  final AIInsight insight;
  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.auto_awesome, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 10),
            Text(insight.summary, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 12),
            _section(theme, l10n.aiWhyItMatters, insight.whyItMatters),
            const SizedBox(height: 10),
            _bulletSection(theme, l10n.aiWhatToWatch, insight.whatToWatch, Icons.visibility_outlined),
            const SizedBox(height: 10),
            _bulletSection(theme, l10n.aiRisks, insight.risks, Icons.warning_amber_rounded),
            const SizedBox(height: 12),
            Text(
              l10n.aiDisclaimerShort,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _section(ThemeData theme, String label, String body) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(body, style: theme.textTheme.bodySmall),
      ],
    );
  }

  Widget _bulletSection(ThemeData theme, String label, List<String> items, IconData icon) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 14, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(child: Text(item, style: theme.textTheme.bodySmall)),
              ],
            ),
          ),
      ],
    );
  }
}
