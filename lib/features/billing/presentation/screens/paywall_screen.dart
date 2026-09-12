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
    final theme = Theme.of(context);
    final controller = context.watch<EntitlementController>();
    final currentTier = controller.entitlement.tier;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.premiumTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              const Text('⭐', style: TextStyle(fontSize: 22)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.premiumHeroTitle,
                  style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            l10n.premiumHeroSubtitle,
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            '${l10n.premiumCurrentPlan}: ${premiumTierLabel(l10n, currentTier)}',
            style: theme.textTheme.labelMedium,
          ),
          const SizedBox(height: 16),
          _FreeTierCard(isCurrent: currentTier == PremiumTier.free),
          const SizedBox(height: 12),
          for (final product in ProductCatalog.all) ...[
            _ProductCard(
              product: product,
              isCurrent: currentTier == product.tier,
              badge: product.id == ProductCatalog.proYearly.id
                  ? l10n.badgeMostPopular
                  : product.id == ProductCatalog.proLifetime.id
                      ? l10n.badgeBestValue
                      : null,
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
                Text(l10n.premiumFree, style: Theme.of(context).textTheme.titleMedium),
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
  const _ProductCard({required this.product, required this.isCurrent, this.badge});

  final Product product;
  final bool isCurrent;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (badge != null)
            Container(
              width: double.infinity,
              color: theme.colorScheme.primary,
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                badge!,
                textAlign: TextAlign.center,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onPrimary,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.4,
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(premiumTierLabel(l10n, product.tier), style: theme.textTheme.titleMedium),
                    const SizedBox(width: 8),
                    PremiumBadge(tier: product.tier),
                    const Spacer(),
                    Text(
                      productPriceLabel(l10n, product),
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                for (final feature in product.features)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
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
                          child: Text(productCtaLabel(l10n, product)),
                        ),
                ),
              ],
            ),
          ),
        ],
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
        title: Text(l10n.premiumConfirmDialogTitle),
        content: Text(l10n.premiumConfirmDialogBody(productTitle, productPriceLabel(l10n, product))),
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
