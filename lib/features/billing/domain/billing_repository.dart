import 'package:in_app_purchase/in_app_purchase.dart';

import 'entitlement.dart';
import 'product.dart';

/// Production path: Flutter → Google Play Billing → (future) server-side
/// receipt verification via the MKR Cloudflare Worker → entitlement
/// persisted server-side. [PlayBillingRepository] is the real
/// implementation (2026-09-17 AdMob + Billing task); [MockBillingRepository]
/// remains for demo mode and tests, and never marks a purchase successful
/// except in direct response to an explicit, clearly-labeled user action.
abstract class BillingRepository {
  /// The last known entitlement - local/cached, safe to call synchronously-
  /// feeling and offline. NEVER the sole grant of Premium on its own (see
  /// [refreshFromStore]) - only ever set as a direct result of a real
  /// purchase/restore event.
  Future<PremiumTier> getCurrentTier();

  Future<PremiumTier> purchase(Product product);

  Future<PremiumTier> restore();

  /// Real store-provided product listings (price, currency, subscription
  /// base-plan offers) keyed by Play product ID, when the store has
  /// responded - empty if unavailable (offline, purchasing not supported
  /// on this platform, or the products aren't configured in Play Console
  /// yet). Callers must fall back to [ProductCatalog]'s static display
  /// values when a key is missing, never block on this.
  Future<Map<String, ProductDetails>> queryProductDetails();

  /// Re-validates entitlement against Play's own purchase records (a
  /// bounded, non-blocking `restorePurchases()` call) rather than trusting
  /// the local cache alone - this is the "restore/query as source of
  /// truth" the task requires. Any resulting change (including a
  /// DOWNGRADE if Play no longer reports an active purchase the local
  /// cache still remembers - e.g. an expired/refunded subscription) is
  /// delivered via [entitlementChanges], never returned directly, since
  /// this may resolve well after the call returns.
  Future<void> refreshFromStore();

  /// Fires whenever entitlement changes for a reason other than this
  /// session's own `purchase()`/`restore()` call already returning it -
  /// e.g. a purchase the OS confirms asynchronously, or a correction from
  /// [refreshFromStore].
  Stream<PremiumTier> get entitlementChanges;

  void dispose();
}
