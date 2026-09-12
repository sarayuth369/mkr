import 'package:flutter/material.dart';

import '../utils/formatters.dart';

/// Shown whenever an [ApiState.success] carries isStale=true — makes cached
/// data explicit instead of silently showing outdated numbers.
class StaleDataBanner extends StatelessWidget {
  const StaleDataBanner({super.key, this.lastUpdated});

  final DateTime? lastUpdated;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_outlined, size: 16, color: theme.colorScheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              lastUpdated == null
                  ? 'Showing cached data — offline'
                  : 'Showing cached data — offline · Last updated ${Formatters.dateTime(lastUpdated!)}',
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}
