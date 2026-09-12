import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/billing/domain/entitlement.dart';

void main() {
  test('Free tier is limited and shows ads', () {
    const entitlement = Entitlement(PremiumTier.free);
    expect(entitlement.isAdFree, isFalse);
    expect(entitlement.hasUnlimitedWatchlist, isFalse);
    expect(entitlement.hasUnlimitedAlerts, isFalse);
    expect(entitlement.hasPortfolio, isFalse);
    expect(entitlement.hasUnlimitedAI, isFalse);
    expect(entitlement.hasBasicAIBrief, isTrue);
  });

  test('Pro tier is ad-free with unlimited watchlist/alerts and portfolio, but no unlimited AI', () {
    const entitlement = Entitlement(PremiumTier.pro);
    expect(entitlement.isAdFree, isTrue);
    expect(entitlement.hasUnlimitedWatchlist, isTrue);
    expect(entitlement.hasUnlimitedAlerts, isTrue);
    expect(entitlement.hasPortfolio, isTrue);
    expect(entitlement.hasUnlimitedAI, isFalse);
  });

  test('AI Pro is the only tier with unlimited AI', () {
    const entitlement = Entitlement(PremiumTier.aiPro);
    expect(entitlement.hasUnlimitedAI, isTrue);
    expect(entitlement.isAdFree, isTrue);
  });

  test('Lifetime unlocks everything else but explicitly excludes unlimited AI', () {
    const entitlement = Entitlement(PremiumTier.lifetime);
    expect(entitlement.isAdFree, isTrue);
    expect(entitlement.hasUnlimitedWatchlist, isTrue);
    expect(entitlement.hasPortfolio, isTrue);
    expect(entitlement.hasUnlimitedAI, isFalse, reason: 'Lifetime must not include unlimited AI per product spec');
  });
}
