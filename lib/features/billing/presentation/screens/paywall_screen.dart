import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/premium_badge.dart';
import '../../application/entitlement_controller.dart';
import '../../domain/entitlement.dart';
import '../../domain/product.dart';

class PaywallScreen extends StatelessWidget {
  const PaywallScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<EntitlementController>();
    final currentTier = controller.entitlement.tier;

    return Scaffold(
      appBar: AppBar(title: const Text('Premium')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Choose your plan',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            'Current plan: ${currentTier.label}',
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
                    const SnackBar(content: Text('Purchases restored')),
                  );
                }
              },
              child: const Text('Restore Purchases'),
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Free', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                if (isCurrent) const Chip(label: Text('Current Plan')),
              ],
            ),
            const SizedBox(height: 8),
            const Text('Basic market data · Basic news · Basic calendar\n'
                'Limited watchlist & alerts · Basic AI brief · Ads'),
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(product.title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
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
                  ? const OutlinedButton(onPressed: null, child: Text('Current Plan'))
                  : FilledButton(
                      onPressed: () => _confirmPurchase(context, product),
                      child: const Text('Simulate purchase (Phase 1 mock)'),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmPurchase(BuildContext context, Product product) async {
    final controller = context.read<EntitlementController>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Simulate purchase'),
        content: Text(
          'This is a Phase 1 mock purchase for ${product.title} (${product.priceLabel}). '
          'No real payment will be made. Continue?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirm')),
        ],
      ),
    );
    if (confirmed == true) {
      await controller.purchase(product);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${product.title} activated (mock)')),
        );
      }
    }
  }
}
