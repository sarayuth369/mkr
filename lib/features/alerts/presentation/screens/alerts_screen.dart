import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/alert_card.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../application/alerts_controller.dart';
import 'create_alert_screen.dart';

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<AlertsController>();
    final entitlement = context.watch<EntitlementController>().entitlement;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.alertsTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: l10n.createAlert,
            onPressed: () => _createAlert(context, controller, entitlement),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: controller.state.when(
          loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingSkeletonList(rows: 4)),
          error: (message) => ErrorState(message: message, onRetry: controller.refresh),
          empty: () => ListView(
            children: [
              EmptyState(
                message: '${l10n.alertsEmpty}. ${l10n.alertsCreateFirst}.',
                icon: Icons.notifications_none,
                actionLabel: l10n.createAlert,
                onAction: () => _createAlert(context, controller, entitlement),
              ),
            ],
          ),
          success: (alerts, isStale, lastUpdated) => ListView.builder(
            // 2026-09-17 Final UX/Reliability task: matches the `all(16)`
            // content-padding convention every other main list screen uses.
            padding: const EdgeInsets.all(16),
            itemCount: alerts.length,
            itemBuilder: (context, index) {
              final alert = alerts[index];
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AlertCard(
                  alert: alert,
                  onToggle: (value) => controller.toggle(alert.id, value),
                  onDelete: () => controller.delete(alert.id),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  void _createAlert(BuildContext context, AlertsController controller, Entitlement entitlement) {
    final currentCount = controller.state.dataOrNull?.length ?? 0;
    if (!entitlement.hasUnlimitedAlerts && currentCount >= Entitlement.freeAlertsLimit) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen()));
      return;
    }
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateAlertScreen()));
  }
}
