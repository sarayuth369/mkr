import '../../../l10n/generated/app_localizations.dart';
import '../domain/entitlement.dart';

String premiumTierLabel(AppLocalizations l10n, PremiumTier tier) => switch (tier) {
      PremiumTier.free => l10n.premiumFree,
      PremiumTier.pro => l10n.premiumPro,
      PremiumTier.aiPro => l10n.premiumAiPro,
      PremiumTier.lifetime => l10n.premiumLifetime,
    };
