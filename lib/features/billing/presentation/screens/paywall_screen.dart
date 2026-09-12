import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/premium_badge.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../application/entitlement_controller.dart';
import '../../domain/entitlement.dart';
import '../../domain/product.dart';
import '../premium_tier_label.dart';

class PaywallScreen extends StatelessWidget {
  const PaywallScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<EntitlementController>();
    final currentTier = controller.entitlement.tier;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.premiumTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            l10n.premiumChooseYourPlan,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            '${l10n.premiumCurrentPlan}: ${premiumTierLabel(l10n, currentTier)}',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          _FreeTierCard(isCurrent: currentTier == PremiumTier.free),
          const SizedBox(height: 12),
          for (final product in ProductCatalog.all) ...[
            _ProductCard(
              product: product,
              isCurrent: currentTier == product.tier,
            ),
            const SizedBox(height: 12),
          ],
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              onPressed: () async {
                await controller.restore();
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(l10n.purchasesRestoredMessage)),
                  );
                }
              },
              child: Text(l10n.premiumRestorePurchases),
            ),
          ),
        ],
      ),
    );
  }
}

class _FreeTierCard extends StatelessWidget {
  const _FreeTierCard({required this.isCurrent});

  final bool isCurrent;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(l10n.premiumFree, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                if (isCurrent) Chip(label: Text(l10n.premiumCurrentPlan)),
              ],
            ),
            const SizedBox(height: 8),
            Text(l10n.premiumFreeFeatures),
          ],
        ),
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.isCurrent});

  final Product product;
  final bool isCurrent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(premiumTierLabel(l10n, product.tier), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                PremiumBadge(tier: product.tier),
                const Spacer(),
                Text(product.priceLabel, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 8),
            for (final feature in product.features)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(
                  children: [
                    Icon(Icons.check, size: 16, color: theme.colorScheme.primary),
                    const SizedBox(width: 6),
                    Expanded(child: Text(feature, style: theme.textTheme.bodySmall)),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: isCurrent
                  ? OutlinedButton(onPressed: null, child: Text(l10n.premiumCurrentPlan))
                  : FilledButton(
                      onPressed: () => _confirmPurchase(context, product),
                      child: Text(l10n.premiumSimulatePurchase),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmPurchase(BuildContext context, Product product) async {
    final l10n = AppLocalizations.of(context);
    final controller = context.read<EntitlementController>();
    final productTitle = premiumTierLabel(l10n, product.tier);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.premiumSimulatePurchaseDialogTitle),
        content: Text(l10n.premiumMockPurchaseConfirm(productTitle, product.priceLabel)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l10n.confirmLabel)),
        ],
      ),
    );
    if (confirmed == true) {
      await controller.purchase(product);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.premiumActivatedMessage(productTitle))),
        );
      }
    }
  }
}
