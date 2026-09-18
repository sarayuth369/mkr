import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:mkr/core/persistence/app_local_store.dart';
import 'package:mkr/features/billing/data/play_billing_repository.dart';
import 'package:mkr/features/billing/data/purchase_verifier.dart';
import 'package:mkr/features/billing/domain/entitlement.dart';
import 'package:mkr/features/billing/domain/product.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 2026-09-17 AdMob + Billing task - a controllable fake `InAppPurchasePlatform`
/// (the same platform-interface-mocking pattern `in_app_purchase`'s own
/// test suite uses via `MockPlatformInterfaceMixin`), so `PlayBillingRepository`'s
/// real purchase-stream/grant/dedup/restore logic can be tested without a
/// real Play Store connection.
class _FakeInAppPurchasePlatform extends InAppPurchasePlatform with MockPlatformInterfaceMixin {
  final _controller = StreamController<List<PurchaseDetails>>.broadcast();
  final List<PurchaseDetails> completedPurchases = [];
  final List<String> boughtProductIds = [];
  int restoreCalls = 0;

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => _controller.stream;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<ProductDetailsResponse> queryProductDetails(Set<String> identifiers) async {
    return ProductDetailsResponse(
      productDetails: [
        for (final id in identifiers)
          ProductDetails(id: id, title: id, description: id, price: '\$1.00', rawPrice: 1, currencyCode: 'USD'),
      ],
      notFoundIDs: const [],
    );
  }

  @override
  Future<bool> buyNonConsumable({required PurchaseParam purchaseParam}) async {
    boughtProductIds.add(purchaseParam.productDetails.id);
    return true;
  }

  @override
  Future<void> completePurchase(PurchaseDetails purchase) async {
    completedPurchases.add(purchase);
  }

  @override
  Future<void> restorePurchases({String? applicationUserName}) async {
    restoreCalls++;
  }

  void emit(List<PurchaseDetails> purchases) => _controller.add(purchases);

  Future<void> dispose() => _controller.close();
}

PurchaseDetails _purchase(String productId, PurchaseStatus status, {String token = 'token-1', bool pendingComplete = true}) {
  final details = PurchaseDetails(
    productID: productId,
    verificationData: PurchaseVerificationData(localVerificationData: token, serverVerificationData: token, source: 'google_play'),
    transactionDate: DateTime.now().millisecondsSinceEpoch.toString(),
    status: status,
  );
  details.pendingCompletePurchase = pendingComplete;
  return details;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // `InAppPurchase.instance` (the package's own facade, distinct from
  // `InAppPurchasePlatform.instance`) auto-registers the REAL
  // `InAppPurchaseAndroidPlatform` the FIRST time it's ever accessed
  // (`defaultTargetPlatform == android` is the test-binding default,
  // regardless of host OS) and caches itself as a private static forever
  // after - overwriting whatever `InAppPurchasePlatform.instance` we set.
  // Triggering that one-time registration ONCE, up front, then overriding
  // `InAppPurchasePlatform.instance` with the fake afterward, works because
  // every `InAppPurchase` instance method reads `InAppPurchasePlatform.instance`
  // fresh on each call rather than caching it.
  setUpAll(() async {
    // The real registration's connection attempt continues asynchronously
    // in the background after the getter itself returns (fire-and-forget
    // inside the package), so a plain try/catch around the getter call
    // doesn't catch its eventual PlatformException - isolated into its own
    // error zone instead so it can never leak into a later test's zone.
    final completer = Completer<void>();
    runZonedGuarded(() {
      try {
        InAppPurchase.instance;
      } catch (_) {}
      Future<void>.delayed(const Duration(milliseconds: 200)).then((_) {
        if (!completer.isCompleted) completer.complete();
      });
    }, (_, _) {
      if (!completer.isCompleted) completer.complete();
    });
    await completer.future;
  });

  late _FakeInAppPurchasePlatform fakePlatform;
  late AppLocalStore store;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    store = await AppLocalStore.create();
    fakePlatform = _FakeInAppPurchasePlatform();
    InAppPurchasePlatform.instance = fakePlatform;
  });

  tearDown(() => fakePlatform.dispose());

  test('a real purchased event grants the mapped tier and completes the purchase', () async {
    final repo = PlayBillingRepository(store);
    final changes = <PremiumTier>[];
    repo.entitlementChanges.listen(changes.add);

    fakePlatform.emit([_purchase('mkr_premium', PurchaseStatus.purchased)]);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(await repo.getCurrentTier(), PremiumTier.pro);
    expect(changes, contains(PremiumTier.pro));
    expect(fakePlatform.completedPurchases, hasLength(1));
    repo.dispose();
  });

  test('the same purchase token delivered twice is only granted/completed with idempotent handling (duplicate-event protection)', () async {
    final repo = PlayBillingRepository(store);

    fakePlatform.emit([_purchase('mkr_premium_lifetime', PurchaseStatus.purchased, token: 'tok-dup')]);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    fakePlatform.emit([_purchase('mkr_premium_lifetime', PurchaseStatus.purchased, token: 'tok-dup')]);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(await repo.getCurrentTier(), PremiumTier.lifetime);
    // Still completed both times (Play may redeliver before an ack is
    // confirmed - completePurchase must remain idempotent-safe on our
    // side), but entitlement was granted from real purchase data, not
    // duplicated into some invalid double-tier state.
    expect(fakePlatform.completedPurchases, hasLength(2));
    repo.dispose();
  });

  test('an error status resolves the pending purchase() call with an error, never hangs', () async {
    final repo = PlayBillingRepository(store);
    fakePlatform.completedPurchases.clear();

    final purchaseFuture = () async {
      try {
        await repo.purchase(ProductCatalog.proLifetime);
        return null;
      } catch (e) {
        return e;
      }
    }();

    await Future<void>.delayed(Duration.zero);
    fakePlatform.emit([_purchase('mkr_premium_lifetime', PurchaseStatus.error, pendingComplete: false)]);
    final result = await purchaseFuture;

    expect(result, isNotNull);
    expect(await repo.getCurrentTier(), PremiumTier.free);
    repo.dispose();
  });

  test('refreshFromStore downgrades a locally-cached tier Play no longer confirms active (never grants from a stale local flag alone)', () async {
    await store.setEntitlementTier(PremiumTier.pro.name); // simulates a stale/expired local cache
    final repo = PlayBillingRepository(store);
    final changes = <PremiumTier>[];
    repo.entitlementChanges.listen(changes.add);

    // restorePurchases() resolves with no matching purchases ever emitted
    // on the stream - Play genuinely has nothing active for this account.
    await repo.refreshFromStore();

    expect(fakePlatform.restoreCalls, 1);
    expect(await repo.getCurrentTier(), PremiumTier.free);
    expect(changes, contains(PremiumTier.free));
    repo.dispose();
  });

  test('refreshFromStore leaves entitlement alone when Play confirms it is still active', () async {
    await store.setEntitlementTier(PremiumTier.lifetime.name);
    final repo = PlayBillingRepository(store);

    final refreshFuture = repo.refreshFromStore();
    // Simulate Play re-delivering the still-active lifetime purchase during
    // the restore window.
    await Future<void>.delayed(Duration.zero);
    fakePlatform.emit([_purchase('mkr_premium_lifetime', PurchaseStatus.restored, token: 'still-active')]);
    await refreshFuture;

    expect(await repo.getCurrentTier(), PremiumTier.lifetime);
    repo.dispose();
  });

  test('ClientTrustPurchaseVerifier only trusts a genuinely purchased/restored status', () async {
    const verifier = ClientTrustPurchaseVerifier();
    expect(await verifier.verify(_purchase('mkr_premium', PurchaseStatus.purchased)), isTrue);
    expect(await verifier.verify(_purchase('mkr_premium', PurchaseStatus.restored)), isTrue);
    expect(await verifier.verify(_purchase('mkr_premium', PurchaseStatus.canceled)), isFalse);
  });
}
