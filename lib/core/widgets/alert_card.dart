import 'package:flutter/material.dart';

import '../../features/alerts/domain/alert.dart';
import '../../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';

String alertTypeLabel(AppLocalizations l10n, AlertType type) => switch (type) {
      AlertType.price => l10n.alertTypePrice,
      AlertType.percentage => l10n.alertTypePercentage,
      AlertType.event => l10n.alertTypeEvent,
      AlertType.radar => l10n.alertTypeRadar,
    };

/// Derived purely in the presentation layer from [Alert.isEnabled] +
/// [Alert.lastTriggeredAt] — no domain/model change needed.
enum AlertStatus { active, triggered, paused }

AlertStatus alertStatusOf(Alert alert) {
  if (!alert.isEnabled) return AlertStatus.paused;
  if (alert.lastTriggeredAt != null) return AlertStatus.triggered;
  return AlertStatus.active;
}

String alertStatusLabel(AppLocalizations l10n, AlertStatus status) => switch (status) {
      AlertStatus.active => l10n.alertStatusActive,
      AlertStatus.triggered => l10n.alertStatusTriggered,
      AlertStatus.paused => l10n.alertStatusPaused,
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

  Color _accentColor(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colors = context.marketColors;
    return switch (alert.type) {
      AlertType.price => scheme.primary,
      AlertType.percentage => scheme.tertiary,
      AlertType.event => colors.impactMedium,
      AlertType.radar => scheme.secondary,
    };
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final accent = _accentColor(context);
    final colors = context.marketColors;
    final status = alertStatusOf(alert);
    final statusColor = switch (status) {
      AlertStatus.active => colors.gain,
      AlertStatus.triggered => colors.impactMedium,
      AlertStatus.paused => theme.colorScheme.onSurfaceVariant,
    };

    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: CircleAvatar(
          backgroundColor: accent.withValues(alpha: 0.15),
          child: Icon(_icon, color: accent, size: 20),
        ),
        title: Text(
          localizedAlertSummary(l10n, alert),
          style: const TextStyle(fontWeight: FontWeight.w600),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Row(
          children: [
            Text(alertTypeLabel(l10n, alert.type).toUpperCase(), style: theme.textTheme.labelSmall),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                alertStatusLabel(l10n, status).toUpperCase(),
                style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
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
