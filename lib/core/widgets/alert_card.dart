import 'package:flutter/material.dart';

import '../../features/alerts/domain/alert.dart';
import '../../l10n/generated/app_localizations.dart';

String alertTypeLabel(AppLocalizations l10n, AlertType type) => switch (type) {
      AlertType.price => l10n.alertTypePrice,
      AlertType.percentage => l10n.alertTypePercentage,
      AlertType.event => l10n.alertTypeEvent,
      AlertType.radar => l10n.alertTypeRadar,
    };

String radarTransitionLabel(AppLocalizations l10n, RadarTransition transition) => switch (transition) {
      RadarTransition.neutralToBullish => l10n.radarTransitionNeutralBullish,
      RadarTransition.neutralToBearish => l10n.radarTransitionNeutralBearish,
      RadarTransition.bullishToNeutral => l10n.radarTransitionBullishNeutral,
      RadarTransition.bearishToNeutral => l10n.radarTransitionBearishNeutral,
    };

/// On-screen summary for an alert card. Kept in the presentation layer (has
/// [BuildContext]) rather than on [Alert] itself, since the model is also
/// used to compose the (English) mock notification body where no locale
/// context is available.
String localizedAlertSummary(AppLocalizations l10n, Alert alert) => switch (alert.type) {
      AlertType.price =>
        '${alert.symbol} ${alert.priceDirection == PriceDirection.above ? '>' : '<'} ${alert.priceTarget?.toStringAsFixed(2)}',
      AlertType.percentage => '${alert.symbol} ±${alert.percentageThreshold?.toStringAsFixed(1)}%',
      AlertType.event => '${l10n.alertTypeEvent}: ${alert.eventKeyword}',
      AlertType.radar =>
        '${alert.symbol} ${alert.radarTransition != null ? radarTransitionLabel(l10n, alert.radarTransition!) : ''}',
    };

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
    final l10n = AppLocalizations.of(context);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Icon(_icon, color: theme.colorScheme.onPrimaryContainer, size: 20),
        ),
        title: Text(localizedAlertSummary(l10n, alert), style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(alertTypeLabel(l10n, alert.type).toUpperCase(), style: theme.textTheme.labelSmall),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Switch(value: alert.isEnabled, onChanged: onToggle),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: onDelete,
              tooltip: l10n.delete,
            ),
          ],
        ),
      ),
    );
  }
}
