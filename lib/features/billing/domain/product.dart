import 'entitlement.dart';

enum BillingPeriod { monthly, yearly, lifetime }

class Product {
  const Product({
    required this.id,
    required this.tier,
    required this.title,
    required this.priceThb,
    required this.period,
    required this.features,
  });

  final String id;
  final PremiumTier tier;
  final String title;
  final num priceThb;
  final BillingPeriod period;
  final List<String> features;

  String get priceLabel => switch (period) {
        BillingPeriod.monthly => '฿$priceThb/month',
        BillingPeriod.yearly => '฿$priceThb/year',
        BillingPeriod.lifetime => '฿$priceThb one-time',
      };
}

/// The four commercial tiers exactly as specified. Kept as static data —
/// no remote product catalog fetch needed until Play Billing is wired up.
const _proFeatures = [
  'No Ads',
  'Unlimited watchlist',
  'Unlimited alerts',
  'Advanced alerts',
  'Full calendar',
  'Portfolio',
  'Advanced market information',
];

const _aiProFeatures = [
  'Everything in Pro',
  'AI Market Brief',
  'AI Asset Analysis',
  'AI News Impact',
  'Personalized Radar',
  'Smart Radar Alerts',
];

class ProductCatalog {
  ProductCatalog._();

  static const proMonthly = Product(
    id: 'pro_monthly',
    tier: PremiumTier.pro,
    title: 'Pro',
    priceThb: 79,
    period: BillingPeriod.monthly,
    features: _proFeatures,
  );

  static const proYearly = Product(
    id: 'pro_yearly',
    tier: PremiumTier.pro,
    title: 'Pro',
    priceThb: 790,
    period: BillingPeriod.yearly,
    features: _proFeatures,
  );

  static const aiProMonthly = Product(
    id: 'ai_pro_monthly',
    tier: PremiumTier.aiPro,
    title: 'AI Pro',
    priceThb: 149,
    period: BillingPeriod.monthly,
    features: _aiProFeatures,
  );

  static const aiProYearly = Product(
    id: 'ai_pro_yearly',
    tier: PremiumTier.aiPro,
    title: 'AI Pro',
    priceThb: 1490,
    period: BillingPeriod.yearly,
    features: _aiProFeatures,
  );

  static const proLifetime = Product(
    id: 'pro_lifetime',
    tier: PremiumTier.lifetime,
    title: 'Pro Lifetime',
    priceThb: 1990,
    period: BillingPeriod.lifetime,
    features: [
      'Everything in Pro, forever',
      'One-time payment',
      'Does not include unlimited AI',
    ],
  );

  static const all = [proMonthly, proYearly, aiProMonthly, aiProYearly, proLifetime];
}
