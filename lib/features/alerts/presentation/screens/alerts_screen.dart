import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/alert_card.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../application/alerts_controller.dart';
import 'create_alert_screen.dart';

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AlertsController>();
    final entitlement = context.watch<EntitlementController>().entitlement;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Alerts'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Create Alert',
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
                message: 'No alerts yet. Create your first alert.',
                icon: Icons.notifications_none,
                actionLabel: 'Create Alert',
                onAction: () => _createAlert(context, controller, entitlement),
              ),
            ],
          ),
          success: (alerts, isStale, lastUpdated) => ListView.builder(
            padding: const EdgeInsets.all(12),
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
