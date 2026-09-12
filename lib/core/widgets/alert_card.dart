import 'package:flutter/material.dart';

import '../../features/alerts/domain/alert.dart';

class AlertCard extends StatelessWidget {
  const AlertCard({
    super.key,
    required this.alert,
    required this.onToggle,
    required this.onDelete,
  });

  final Alert alert;
  final ValueChanged<bool> onToggle;
  final VoidCallback onDelete;

  IconData get _icon => switch (alert.type) {
        AlertType.price => Icons.trending_up,
        AlertType.percentage => Icons.percent,
        AlertType.event => Icons.event_note,
        AlertType.radar => Icons.radar,
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Icon(_icon, color: theme.colorScheme.onPrimaryContainer, size: 20),
        ),
        title: Text(alert.summary, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(alert.type.name.toUpperCase(), style: theme.textTheme.labelSmall),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Switch(value: alert.isEnabled, onChanged: onToggle),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: onDelete,
              tooltip: 'Delete',
            ),
          ],
        ),
      ),
    );
  }
}
