import 'package:flutter/material.dart';

import '../../domain/radar_item.dart';
import '../utils/formatters.dart';
import 'impact_badge.dart';

/// Row for one Today's Radar entry: time, title, impact — sorted by the
/// caller HIGH → MEDIUM → LOW.
class RadarCard extends StatelessWidget {
  const RadarCard({super.key, required this.item});

  final RadarItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 48,
            child: Text(
              Formatters.time(item.time),
              style: theme.textTheme.labelMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                if (item.subtitle != null)
                  Text(
                    item.subtitle!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
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
