import 'entitlement.dart';
import 'product.dart';

/// Production path: Flutter → Google Play Billing → server-side receipt
/// verification via Cloudflare Worker → entitlement persisted server-side.
/// [MockBillingRepository] simulates this locally in Phase 1 and never
/// marks a purchase successful except in direct response to an explicit,
/// clearly-labeled user action.
abstract class BillingRepository {
  Future<PremiumTier> getCurrentTier();

  Future<PremiumTier> purchase(Product product);

  Future<PremiumTier> restore();
}
