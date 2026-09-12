enum PremiumTier { free, pro, aiPro, lifetime }

extension PremiumTierX on PremiumTier {
  String get label => switch (this) {
        PremiumTier.free => 'Free',
        PremiumTier.pro => 'Pro',
        PremiumTier.aiPro => 'AI Pro',
        PremiumTier.lifetime => 'Pro Lifetime',
      };
}

/// What the current tier actually unlocks. Kept as pure, unit-testable
/// logic separate from the billing repository so the rules (especially
/// "Lifetime excludes unlimited AI") are easy to verify.
class Entitlement {
  const Entitlement(this.tier);

  final PremiumTier tier;

  bool get isAdFree => tier != PremiumTier.free;

  bool get hasUnlimitedWatchlist => tier != PremiumTier.free;

  bool get hasUnlimitedAlerts => tier != PremiumTier.free;

  bool get hasAdvancedAlerts => tier != PremiumTier.free;

  bool get hasFullCalendar => tier != PremiumTier.free;

  bool get hasPortfolio => tier != PremiumTier.free;

  bool get hasAdvancedMarketInfo => tier != PremiumTier.free;

  /// AI Pro is the only tier with unlimited AI. Lifetime intentionally does
  /// NOT include unlimited AI per product spec.
  bool get hasUnlimitedAI => tier == PremiumTier.aiPro;

  bool get hasBasicAIBrief => true;

  static const int freeWatchlistLimit = 3;
  static const int freeAlertsLimit = 2;
}
