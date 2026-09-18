import 'dart:async';

import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';

import '../../../core/persistence/app_local_store.dart';
import '../domain/billing_repository.dart';
import '../domain/entitlement.dart';
import '../domain/product.dart';
import 'purchase_verifier.dart';

/// Real Google Play Billing (`in_app_purchase` + `in_app_purchase_android`)
/// implementation of [BillingRepository] — 2026-09-17 AdMob + Billing task.
///
/// Design notes, since Play Billing's actual API is stream-based and async
/// in ways the original 3-method interface doesn't fully capture on its
/// own (see [BillingRepository]'s expanded contract):
///
/// - **Single purchase-stream listener, for the app's whole lifetime**:
///   set up once in the constructor, never per-call. Every purchase update
///   — whether it's this session's own `purchase()` call resolving, a
///   purchase Play redelivers unprompted on a cold start, or a
///   `restorePurchases()` response — flows through the ONE
///   [_onPurchaseUpdate] handler, so there is exactly one place that ever
///   grants/revokes entitlement from a real purchase record.
/// - **Never grants from a local flag alone**: [AppLocalStore.entitlementTier]
///   is written ONLY inside [_onPurchaseUpdate], in direct response to a
///   `purchased`/`restored` [PurchaseDetails] Play itself delivered -
///   there is no other write path to that key in this class.
/// - **Duplicate-event protection**: Android's Billing Library can and
///   does redeliver the same purchase (e.g. after `completePurchase` is
///   called, or across a cold start before acknowledgment is fully
///   propagated) - [_processedPurchaseTokens] makes re-processing the same
///   `serverVerificationData` (the purchase token) a no-op beyond ensuring
///   it's acknowledged/completed.
/// - **Acknowledge/complete**: every purchase with `pendingCompletePurchase
///   == true` is completed via [InAppPurchase.completePurchase] - Play
///   auto-refunds an unacknowledged purchase after ~3 days, so skipping
///   this would silently lose real revenue.
/// - **Restore-as-source-of-truth for downgrades**: [refreshFromStore]
///   calls `restorePurchases()` and, once Android's query completes,
///   checks whether every currently-cached-as-paid product was actually
///   confirmed active during that restore window - if not (e.g. an
///   expired/refunded subscription Play no longer reports), the local
///   cache is corrected back down via [entitlementChanges]. This is a
///   real, working "ask Play, not the local flag" check; it is bounded to
///   the restore call's own response, not a continuous server-pushed
///   expiry webhook (that would need real server-side verification - see
///   [PurchaseVerifier]'s own doc comment for why that's a separate,
///   not-yet-configured piece).
class PlayBillingRepository implements BillingRepository {
  PlayBillingRepository(this._store, {PurchaseVerifier? verifier}) : _verifier = verifier ?? const ClientTrustPurchaseVerifier() {
    _subscription = _iap.purchaseStream.listen(_onPurchaseUpdate, onError: (Object error, StackTrace _) {
      _pendingPurchase?.completeError(error);
      _pendingPurchase = null;
    });
  }

  final AppLocalStore _store;
  final InAppPurchase _iap = InAppPurchase.instance;
  final PurchaseVerifier _verifier;
  StreamSubscription<List<PurchaseDetails>>? _subscription;
  final _entitlementController = StreamController<PremiumTier>.broadcast();

  /// Every purchase token (`serverVerificationData`) this repository has
  /// already granted entitlement for and acknowledged/completed at least
  /// once — session-scoped duplicate-event protection (a fresh app launch
  /// naturally re-confirms via Play's own redelivery + [refreshFromStore],
  /// it does not need to remember across restarts).
  final Set<String> _processedPurchaseTokens = {};

  Completer<PremiumTier>? _pendingPurchase;
  String? _pendingPurchasePlayProductId;

  /// Populated only while a [refreshFromStore] restore window is open —
  /// every Play product ID confirmed active during that window. `null`
  /// outside a restore window (so a purchase arriving from a fresh
  /// `purchase()` call, not a restore, is never mistaken for restore data).
  Set<String>? _restoreWindowActiveProductIds;

  @override
  Future<PremiumTier> getCurrentTier() async {
    final raw = _store.entitlementTier;
    if (raw == null) return PremiumTier.free;
    return PremiumTier.values.byName(raw);
  }

  @override
  Future<Map<String, ProductDetails>> queryProductDetails() async {
    try {
      if (!await _iap.isAvailable()) return {};
      final response = await _iap.queryProductDetails(ProductCatalog.playProductIds);
      if (response.error != null || response.productDetails.isEmpty) return {};
      final result = <String, ProductDetails>{};
      for (final details in response.productDetails) {
        result[_storeLookupKeyFor(details)] = details;
      }
      return result;
    } catch (_) {
      // Offline, Play Store app unavailable, or products not yet
      // configured in Play Console — callers fall back to ProductCatalog's
      // static display prices, never a crash for a display-only concern.
      return {};
    }
  }

  /// Mirrors [Product.storeLookupKey] on the Play-response side — a
  /// [GooglePlayProductDetails] for a subscription carries its base-plan
  /// ID via `productDetails.subscriptionOfferDetails[subscriptionIndex]`,
  /// not on the flat `id` (which is only the outer Play product ID and is
  /// identical across every base plan of the same subscription).
  String _storeLookupKeyFor(ProductDetails details) {
    if (details is GooglePlayProductDetails && details.subscriptionIndex != null) {
      final offers = details.productDetails.subscriptionOfferDetails;
      final basePlanId = offers != null && details.subscriptionIndex! < offers.length ? offers[details.subscriptionIndex!].basePlanId : null;
      if (basePlanId != null) return '${details.id}:$basePlanId';
    }
    return details.id;
  }

  @override
  Future<PremiumTier> purchase(Product product) async {
    final details = (await queryProductDetails())[product.storeLookupKey];
    if (details == null) {
      throw StateError('${product.playProductId} (${product.basePlanId ?? 'no base plan'}) is not available from Google Play right now.');
    }

    final PurchaseParam param;
    if (details is GooglePlayProductDetails && details.offerToken != null) {
      param = GooglePlayPurchaseParam(productDetails: details, offerToken: details.offerToken);
    } else {
      param = PurchaseParam(productDetails: details);
    }

    _pendingPurchase = Completer<PremiumTier>();
    _pendingPurchasePlayProductId = product.playProductId;
    final started = await _iap.buyNonConsumable(purchaseParam: param);
    if (!started) {
      _pendingPurchase = null;
      _pendingPurchasePlayProductId = null;
      throw StateError('Google Play did not start the purchase flow.');
    }
    // Resolves inside _onPurchaseUpdate once Play actually reports an
    // outcome for this product — never fabricated here.
    return _pendingPurchase!.future;
  }

  @override
  Future<PremiumTier> restore() async {
    await refreshFromStore();
    return getCurrentTier();
  }

  @override
  Future<void> refreshFromStore() async {
    _restoreWindowActiveProductIds = {};
    try {
      await _iap.restorePurchases();
      // Android's queryPurchasesAsync (which backs restorePurchases) is
      // itself async on top of the Future above — give the purchaseStream
      // a bounded window to actually deliver results before deciding
      // nothing further is coming. Never blocks the caller indefinitely.
      await Future<void>.delayed(const Duration(seconds: 2));
      await _reconcileAfterRestoreWindow();
    } finally {
      _restoreWindowActiveProductIds = null;
    }
  }

  /// If the locally-cached tier's own Play product was NOT confirmed
  /// active during the just-completed restore window, the local cache is
  /// stale (e.g. the subscription lapsed/was refunded) — corrected back
  /// down here rather than left to silently keep granting Premium forever
  /// from a flag Play itself no longer backs.
  Future<void> _reconcileAfterRestoreWindow() async {
    final activeIds = _restoreWindowActiveProductIds ?? {};
    final currentTier = await getCurrentTier();
    if (currentTier == PremiumTier.free) return;
    final expectedPlayProductId = switch (currentTier) {
      PremiumTier.pro => 'mkr_premium',
      PremiumTier.aiPro => 'mkr_premium_ai',
      PremiumTier.lifetime => 'mkr_premium_lifetime',
      PremiumTier.free => null,
    };
    if (expectedPlayProductId != null && !activeIds.contains(expectedPlayProductId)) {
      await _store.setEntitlementTier(PremiumTier.free.name);
      _entitlementController.add(PremiumTier.free);
    }
  }

  Future<void> _onPurchaseUpdate(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      await _handleOnePurchase(purchase);
    }
  }

  Future<void> _handleOnePurchase(PurchaseDetails purchase) async {
    switch (purchase.status) {
      case PurchaseStatus.pending:
        return; // UI may show a pending indicator; nothing to grant yet.

      case PurchaseStatus.error:
        if (_pendingPurchasePlayProductId == purchase.productID) {
          _pendingPurchase?.completeError(purchase.error ?? StateError('Purchase failed.'));
          _pendingPurchase = null;
          _pendingPurchasePlayProductId = null;
        }
        return;

      case PurchaseStatus.canceled:
        if (_pendingPurchasePlayProductId == purchase.productID) {
          _pendingPurchase?.complete(await getCurrentTier());
          _pendingPurchase = null;
          _pendingPurchasePlayProductId = null;
        }
        return;

      case PurchaseStatus.purchased:
      case PurchaseStatus.restored:
        await _grantFromRealPurchase(purchase);
    }
  }

  Future<void> _grantFromRealPurchase(PurchaseDetails purchase) async {
    _restoreWindowActiveProductIds?.add(purchase.productID);

    final token = purchase.verificationData.serverVerificationData;
    final alreadyProcessed = !_processedPurchaseTokens.add(token);

    if (!alreadyProcessed) {
      // Section 8 of the task ("prepare a clean server-verification
      // abstraction... do not invent verification"): no Google Play
      // Developer API service account exists yet, so there is nothing
      // real to verify against server-side. ClientTrustPurchaseVerifier
      // honestly trusts Play's own client-delivered purchase state (the
      // same signal Play's own Billing Library itself is built around) -
      // see purchase_verifier.dart for the real hook point a future
      // ServerPurchaseVerifier would plug into here, unchanged.
      final verified = await _verifier.verify(purchase);
      if (verified) {
        final tier = ProductCatalog.tierForPlayProductId(purchase.productID);
        if (tier != null) {
          final current = await getCurrentTier();
          // Never downgrades from a purchase event - only a confirmed-
          // absent restore window (_reconcileAfterRestoreWindow) does that.
          if (_tierRank(tier) >= _tierRank(current)) {
            await _store.setEntitlementTier(tier.name);
            _entitlementController.add(tier);
          }
        }
      }
    }

    if (purchase.pendingCompletePurchase) {
      await _iap.completePurchase(purchase);
    }

    if (_pendingPurchasePlayProductId == purchase.productID) {
      _pendingPurchase?.complete(await getCurrentTier());
      _pendingPurchase = null;
      _pendingPurchasePlayProductId = null;
    }
  }

  /// Lifetime and AI Pro are never "lower" than Pro for this purpose -
  /// this only prevents a stale/duplicate lower-tier event from ever
  /// clobbering an already-granted higher one within the same session.
  int _tierRank(PremiumTier tier) => switch (tier) {
        PremiumTier.free => 0,
        PremiumTier.pro => 1,
        PremiumTier.aiPro => 2,
        PremiumTier.lifetime => 2,
      };

  @override
  Stream<PremiumTier> get entitlementChanges => _entitlementController.stream;

  @override
  void dispose() {
    _subscription?.cancel();
    _entitlementController.close();
  }
}
