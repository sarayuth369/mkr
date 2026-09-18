import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/premium_badge.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../application/entitlement_controller.dart';
import '../../domain/billing_repository.dart';
import '../../domain/entitlement.dart';
import '../../domain/product.dart';
import '../premium_tier_label.dart';

class PaywallScreen extends StatefulWidget {
  const PaywallScreen({super.key});

  @override
  State<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends State<PaywallScreen> {
  BillingPeriod _period = BillingPeriod.monthly;

  /// 2026-09-17 AdMob + Billing task - real, store-provided product
  /// listings (price/currency), keyed by [Product.storeLookupKey]. Empty
  /// while loading or if the store is unavailable/unconfigured — every
  /// card below already falls back to [Product]'s static display price in
  /// that case (see `productPriceLabel`), so this screen never blocks on
  /// or breaks without a real network response.
  Map<String, ProductDetails> _storeDetails = {};

  @override
  void initState() {
    super.initState();
    _loadStoreDetails();
  }

  Future<void> _loadStoreDetails() async {
    final details = await context.read<BillingRepository>().queryProductDetails();
    if (mounted) setState(() => _storeDetails = details);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final controller = context.watch<EntitlementController>();
    final currentTier = controller.entitlement.tier;

    final proProduct = _period == BillingPeriod.monthly ? ProductCatalog.proMonthly : ProductCatalog.proYearly;
    final aiProProduct = _period == BillingPeriod.monthly ? ProductCatalog.aiProMonthly : ProductCatalog.aiProYearly;

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
          Center(
            child: SegmentedButton<BillingPeriod>(
              segments: [
                ButtonSegment(value: BillingPeriod.monthly, label: Text(l10n.premiumMonthly)),
                ButtonSegment(value: BillingPeriod.yearly, label: Text(l10n.premiumYearly)),
              ],
              selected: {_period},
              onSelectionChanged: (s) => setState(() => _period = s.first),
            ),
          ),
          const SizedBox(height: 16),
          _FreeTierCard(isCurrent: currentTier == PremiumTier.free),
          const SizedBox(height: 12),
          _ProductCard(
            product: proProduct,
            storeDetails: _storeDetails[proProduct.storeLookupKey],
            isCurrent: currentTier == proProduct.tier,
            savingsPercent: _period == BillingPeriod.yearly
                ? yearlySavingsPercent(ProductCatalog.proMonthly, ProductCatalog.proYearly)
                : null,
          ),
          const SizedBox(height: 12),
          _ProductCard(
            product: aiProProduct,
            storeDetails: _storeDetails[aiProProduct.storeLookupKey],
            isCurrent: currentTier == aiProProduct.tier,
            badge: l10n.badgeMostPopular,
            savingsPercent: _period == BillingPeriod.yearly
                ? yearlySavingsPercent(ProductCatalog.aiProMonthly, ProductCatalog.aiProYearly)
                : null,
          ),
          const SizedBox(height: 12),
          _ProductCard(
            product: ProductCatalog.proLifetime,
            storeDetails: _storeDetails[ProductCatalog.proLifetime.storeLookupKey],
            isCurrent: currentTier == PremiumTier.lifetime,
            badge: l10n.badgeBestValue,
          ),
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              onPressed: () async {
                try {
                  await controller.restore();
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(l10n.purchasesRestoredMessage)),
                    );
                  }
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(l10n.premiumPurchaseFailedMessage)),
                    );
                  }
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

class _ProductCard extends StatefulWidget {
  const _ProductCard({required this.product, required this.isCurrent, this.storeDetails, this.badge, this.savingsPercent});

  final Product product;
  final bool isCurrent;
  final ProductDetails? storeDetails;
  final String? badge;
  final int? savingsPercent;

  @override
  State<_ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<_ProductCard> {
  bool _purchasing = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final product = widget.product;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.badge != null)
            Container(
              width: double.infinity,
              color: theme.colorScheme.primary,
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                widget.badge!,
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
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      productPriceLabel(l10n, product, storeDetails: widget.storeDetails),
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    if (widget.savingsPercent != null && widget.savingsPercent! > 0) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        margin: const EdgeInsets.only(bottom: 3),
                        decoration: BoxDecoration(
                          color: context.marketColors.gain.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          l10n.premiumSavePercent(widget.savingsPercent!),
                          style: TextStyle(color: context.marketColors.gain, fontSize: 11, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
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
                  child: widget.isCurrent
                      ? OutlinedButton(onPressed: null, child: Text(l10n.premiumCurrentPlan))
                      : FilledButton(
                          onPressed: _purchasing ? null : () => _confirmPurchase(context, product),
                          child: _purchasing
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                              : Text(productCtaLabel(l10n, product)),
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
        content: Text(l10n.premiumConfirmDialogBody(productTitle, productPriceLabel(l10n, product, storeDetails: widget.storeDetails))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l10n.confirmLabel)),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _purchasing = true);
    try {
      await controller.purchase(product);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.premiumActivatedMessage(productTitle))),
        );
      }
    } catch (e) {
      // 2026-09-17 AdMob + Billing task: previously purchase() could never
      // fail (the mock never threw) so no error path existed at all - a
      // real Play Billing purchase genuinely can fail/be cancelled, and
      // that must reach the user honestly rather than silently vanishing.
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.premiumPurchaseFailedMessage)),
        );
      }
    } finally {
      if (mounted) setState(() => _purchasing = false);
    }
  }
}
