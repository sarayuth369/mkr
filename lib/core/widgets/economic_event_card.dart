import 'package:flutter/material.dart';

import '../../features/calendar/domain/economic_event.dart';
import '../utils/formatters.dart';
import 'impact_badge.dart';

class EconomicEventCard extends StatelessWidget {
  const EconomicEventCard({super.key, required this.event});

  final EconomicEvent event;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 52,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(Formatters.time(event.dateTime), style: theme.textTheme.labelMedium),
                  Text(
                    event.country,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(event.title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 12,
                    children: [
                      _stat(theme, 'Prev', event.previous),
                      _stat(theme, 'Fcst', event.forecast),
                      _stat(theme, 'Act', event.actual),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            ImpactBadge(impact: event.impact, dense: true),
          ],
        ),
      ),
    );
  }

  Widget _stat(ThemeData theme, String label, String? value) {
    if (value == null) return const SizedBox.shrink();
    return RichText(
      text: TextSpan(
        style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        children: [
          TextSpan(text: '$label '),
          TextSpan(
            text: value,
            style: TextStyle(color: theme.colorScheme.onSurface, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
