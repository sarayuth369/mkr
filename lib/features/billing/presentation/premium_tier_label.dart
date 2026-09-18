import 'package:in_app_purchase/in_app_purchase.dart';

import '../../../l10n/generated/app_localizations.dart';
import '../domain/entitlement.dart';
import '../domain/product.dart';

String premiumTierLabel(AppLocalizations l10n, PremiumTier tier) => switch (tier) {
      PremiumTier.free => l10n.premiumFree,
      PremiumTier.pro => l10n.premiumPro,
      PremiumTier.aiPro => l10n.premiumAiPro,
      PremiumTier.lifetime => l10n.premiumLifetime,
    };

/// Localized price string. Period wording lives here (presentation layer,
/// has [AppLocalizations]) rather than on [Product] itself, so it can be
/// translated.
///
/// 2026-09-17 AdMob + Billing task: prefers the REAL, store-provided,
/// locale/currency-aware [ProductDetails.price] (e.g. "£2.99", "฿99.00")
/// whenever [storeDetails] is available — [Product.price] (a hardcoded USD
/// `num`) is now only the offline/loading-state fallback, per the task's
/// "display price/currency returned by Google Play" requirement.
String productPriceLabel(AppLocalizations l10n, Product product, {ProductDetails? storeDetails}) {
  if (storeDetails != null) {
    return switch (product.period) {
      BillingPeriod.monthly => '${storeDetails.price}${l10n.premiumPerMonth}',
      BillingPeriod.yearly => '${storeDetails.price}${l10n.premiumPerYear}',
      BillingPeriod.lifetime => storeDetails.price,
    };
  }
  final amount = '\$${product.price.toStringAsFixed(2)}';
  return switch (product.period) {
    BillingPeriod.monthly => '$amount${l10n.premiumPerMonth}',
    BillingPeriod.yearly => '$amount${l10n.premiumPerYear}',
    BillingPeriod.lifetime => amount,
  };
}

/// Tier-aware call-to-action for a plan card — reads like a real product
/// button, never exposes internal purchase-flow implementation details.
String productCtaLabel(AppLocalizations l10n, Product product) => switch (product.tier) {
      PremiumTier.pro => l10n.premiumCtaGetPro,
      PremiumTier.aiPro => l10n.premiumCtaGetAiPro,
      PremiumTier.lifetime => l10n.premiumCtaGetLifetime,
      PremiumTier.free => l10n.premiumUpgrade,
    };

/// Rounded "you save N%" percentage for choosing yearly over monthly —
/// computed from the real prices, never hardcoded.
int yearlySavingsPercent(Product monthly, Product yearly) {
  final fullYearAtMonthlyRate = monthly.price * 12;
  final savings = 1 - (yearly.price / fullYearAtMonthlyRate);
  return (savings * 100).round();
}
