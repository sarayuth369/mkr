import 'entitlement.dart';

enum BillingPeriod { monthly, yearly, lifetime }

class Product {
  const Product({
    required this.id,
    required this.playProductId,
    this.basePlanId,
    required this.tier,
    required this.title,
    required this.price,
    required this.period,
    required this.features,
  });

  /// Internal catalog key (unchanged across app releases even if the real
  /// Play product/base-plan IDs are ever restructured) — used for
  /// display/lookup/tests, never sent to Play Billing directly.
  final String id;

  /// 2026-09-17 AdMob + Billing task - the REAL Google Play Console
  /// product ID this [Product] purchases. `mkr_premium` and
  /// `mkr_premium_ai` are subscriptions with `monthly`/`yearly` base plans
  /// (see [basePlanId]); `mkr_premium_lifetime` is a one-time
  /// non-consumable (no base plan). Kept as separate real 2-tier
  /// subscriptions (Pro vs AI Pro) rather than the task's originally
  /// suggested single `mkr_premium` product - the operator explicitly
  /// confirmed keeping the existing, already-live-in-UI 2-tier pricing
  /// model (Pro $2.99/$29.99, AI Pro $5.99/$59.99) rather than collapsing
  /// it, since that would remove a real price point without a product
  /// decision to do so.
  final String playProductId;

  /// The Play Console base-plan ID within [playProductId] for a
  /// subscription (`monthly`/`yearly`) — `null` for the non-consumable
  /// Lifetime product, which has no base plans.
  final String? basePlanId;

  final PremiumTier tier;
  final String title;

  /// USD major units — MKR is a global product, all pricing shown to users
  /// is USD regardless of the app's display-currency setting (that setting
  /// only affects market data, never subscription pricing). This is the
  /// local fallback/display value used only when the real Play-provided
  /// [ProductDetails] price hasn't loaded yet (offline, store unreachable,
  /// or products not yet configured in Play Console) - see
  /// `premium_tier_label.dart`'s `productPriceLabel`, which prefers the
  /// real store price whenever available.
  final num price;
  final BillingPeriod period;
  final List<String> features;

  /// The lookup key [PlayBillingRepository] uses for the real store
  /// listing this product corresponds to - a bare Play product ID for the
  /// non-subscription Lifetime product, or `productId:basePlanId` for a
  /// subscription (since one Play product ID can list multiple base-plan
  /// offers with different prices/periods, disambiguated this way rather
  /// than by ID alone).
  String get storeLookupKey => basePlanId != null ? '$playProductId:$basePlanId' : playProductId;
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
    playProductId: 'mkr_premium',
    basePlanId: 'monthly',
    tier: PremiumTier.pro,
    title: 'Pro',
    price: 2.99,
    period: BillingPeriod.monthly,
    features: _proFeatures,
  );

  static const proYearly = Product(
    id: 'pro_yearly',
    playProductId: 'mkr_premium',
    basePlanId: 'yearly',
    tier: PremiumTier.pro,
    title: 'Pro',
    price: 29.99,
    period: BillingPeriod.yearly,
    features: _proFeatures,
  );

  static const aiProMonthly = Product(
    id: 'ai_pro_monthly',
    playProductId: 'mkr_premium_ai',
    basePlanId: 'monthly',
    tier: PremiumTier.aiPro,
    title: 'AI Pro',
    price: 5.99,
    period: BillingPeriod.monthly,
    features: _aiProFeatures,
  );

  static const aiProYearly = Product(
    id: 'ai_pro_yearly',
    playProductId: 'mkr_premium_ai',
    basePlanId: 'yearly',
    tier: PremiumTier.aiPro,
    title: 'AI Pro',
    price: 59.99,
    period: BillingPeriod.yearly,
    features: _aiProFeatures,
  );

  static const proLifetime = Product(
    id: 'pro_lifetime',
    playProductId: 'mkr_premium_lifetime',
    basePlanId: null,
    tier: PremiumTier.lifetime,
    title: 'Pro Lifetime',
    price: 79.99,
    period: BillingPeriod.lifetime,
    features: _lifetimeFeatures,
  );

  static const all = [proMonthly, proYearly, aiProMonthly, aiProYearly, proLifetime];

  /// Every real Google Play product ID this app knows how to sell -
  /// exactly what [PlayBillingRepository] queries/purchases against.
  static const Set<String> playProductIds = {'mkr_premium', 'mkr_premium_ai', 'mkr_premium_lifetime'};

  static PremiumTier? tierForPlayProductId(String playProductId) => switch (playProductId) {
        'mkr_premium' => PremiumTier.pro,
        'mkr_premium_ai' => PremiumTier.aiPro,
        'mkr_premium_lifetime' => PremiumTier.lifetime,
        _ => null,
      };

  static Product? forPlayProductAndBasePlan(String playProductId, String? basePlanId) {
    for (final product in all) {
      if (product.playProductId == playProductId && product.basePlanId == basePlanId) return product;
    }
    return null;
  }
}
