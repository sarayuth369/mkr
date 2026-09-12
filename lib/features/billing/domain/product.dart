import 'entitlement.dart';

enum BillingPeriod { monthly, yearly, lifetime }

class Product {
  const Product({
    required this.id,
    required this.tier,
    required this.title,
    required this.price,
    required this.period,
    required this.features,
  });

  final String id;
  final PremiumTier tier;
  final String title;

  /// USD major units — MKR is a global product, all pricing shown to users
  /// is USD regardless of the app's display-currency setting (that setting
  /// only affects market data, never subscription pricing). Real pricing
  /// will ultimately come from configured Google Play product IDs matching
  /// [id]; this is the local fallback/display value until that's wired up.
  final num price;
  final BillingPeriod period;
  final List<String> features;
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

const _lifetimeFeatures = [
  'Pro features, permanently',
  'No recurring Pro subscription',
  'AI remains usage/subscription based',
];

class ProductCatalog {
  ProductCatalog._();

  static const proMonthly = Product(
    id: 'pro_monthly',
    tier: PremiumTier.pro,
    title: 'Pro',
    price: 2.99,
    period: BillingPeriod.monthly,
    features: _proFeatures,
  );

  static const proYearly = Product(
    id: 'pro_yearly',
    tier: PremiumTier.pro,
    title: 'Pro',
    price: 29.99,
    period: BillingPeriod.yearly,
    features: _proFeatures,
  );

  static const aiProMonthly = Product(
    id: 'ai_pro_monthly',
    tier: PremiumTier.aiPro,
    title: 'AI Pro',
    price: 5.99,
    period: BillingPeriod.monthly,
    features: _aiProFeatures,
  );

  static const aiProYearly = Product(
    id: 'ai_pro_yearly',
    tier: PremiumTier.aiPro,
    title: 'AI Pro',
    price: 59.99,
    period: BillingPeriod.yearly,
    features: _aiProFeatures,
  );

  static const proLifetime = Product(
    id: 'pro_lifetime',
    tier: PremiumTier.lifetime,
    title: 'Pro Lifetime',
    price: 79.99,
    period: BillingPeriod.lifetime,
    features: _lifetimeFeatures,
  );

  static const all = [proMonthly, proYearly, aiProMonthly, aiProYearly, proLifetime];
}
