import 'package:flutter/material.dart';

import '../../domain/impact_level.dart';
import '../../domain/radar_item.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';
import 'impact_badge.dart';

/// Row for one Today's Radar entry: time, title, impact — sorted by the
/// caller HIGH → MEDIUM → LOW. HIGH-impact entries get a colored accent bar
/// and a subtle tint so the most important events are the ones that jump
/// out first.
class RadarCard extends StatelessWidget {
  const RadarCard({super.key, required this.item});

  final RadarItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = context.marketColors;
    final isHigh = item.impact == ImpactLevel.high;
    final accent = switch (item.impact) {
      ImpactLevel.high => colors.impactHigh,
      ImpactLevel.medium => colors.impactMedium,
      ImpactLevel.low => colors.impactLow,
    };

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: isHigh ? accent.withValues(alpha: 0.08) : null,
        borderRadius: BorderRadius.circular(12),
        border: Border(left: BorderSide(color: accent, width: 3)),
      ),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 44,
            child: Text(
              Formatters.time(item.time),
              style: theme.textTheme.labelMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (item.subtitle != null)
                  Text(
                    item.subtitle!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ImpactBadge(impact: item.impact, dense: true),
        ],
      ),
    );
  }
}
