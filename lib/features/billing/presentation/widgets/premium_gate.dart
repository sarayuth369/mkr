import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../application/entitlement_controller.dart';
import '../screens/paywall_screen.dart';

/// Wraps a feature that requires entitlement. When [isUnlocked] is false the
/// child is replaced by a lock prompt that routes to the Paywall.
class PremiumGate extends StatelessWidget {
  const PremiumGate({
    super.key,
    required this.isUnlocked,
    required this.child,
    required this.featureName,
  });

  final bool isUnlocked;
  final Widget child;
  final String featureName;

  @override
  Widget build(BuildContext context) {
    if (isUnlocked) return child;
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.lock_outline, size: 48, color: theme.colorScheme.outline),
            const SizedBox(height: 12),
            Text(
              l10n.premiumGateFeatureLocked(featureName),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PaywallScreen()),
              ),
              child: Text(l10n.premiumUpgrade),
            ),
          ],
        ),
      ),
    );
  }
}

extension EntitlementWatch on BuildContext {
  EntitlementController get entitlementController => read<EntitlementController>();
}
