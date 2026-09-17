import 'package:flutter/material.dart';

import '../../features/ai/domain/ai_insight.dart';
import '../../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';

/// AI-generated brief shown on Home / Market Detail / Gold Radar. Summary
/// and "why it matters" are always visible; the bulleted "what to watch"
/// and "risks" sections are behind a Read more toggle so the card stays
/// compact by default without hiding the analysis entirely.
class AIInsightCard extends StatefulWidget {
  const AIInsightCard({super.key, required this.insight, required this.title});

  final AIInsight insight;
  final String title;

  @override
  State<AIInsightCard> createState() => _AIInsightCardState();
}

class _AIInsightCardState extends State<AIInsightCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final insight = widget.insight;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                // 2026-09-17 Pre-Closed-Testing Final task: this card is
                // reused on Home/Market Detail/Gold Radar - previously used
                // theme.colorScheme.primary here, while Home's own wrapper
                // additionally applied a violet aiAccent gradient border
                // around the exact same card, and AI Ask's message bubbles
                // use aiAccent for their icon too. Using the dedicated
                // aiAccent token here makes the "this is AI-generated"
                // visual identity consistent everywhere this card appears,
                // independent of which screen wraps it.
                Icon(Icons.auto_awesome, size: 18, color: context.marketColors.aiAccent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.title,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(insight.summary, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 12),
            _section(theme, l10n.aiWhyItMatters, insight.whyItMatters),
            AnimatedCrossFade(
              duration: const Duration(milliseconds: 200),
              crossFadeState: _expanded ? CrossFadeState.showSecond : CrossFadeState.showFirst,
              firstChild: const SizedBox.shrink(),
              secondChild: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
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
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 32)),
                onPressed: () => setState(() => _expanded = !_expanded),
                child: Text(_expanded ? l10n.aiShowLess : l10n.aiReadMore),
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
