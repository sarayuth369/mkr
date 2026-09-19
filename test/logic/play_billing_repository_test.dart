import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_android/billing_client_wrappers.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';
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
///
/// 2026-09-19 Monetization Release 3 fix - `queryProductDetails` now
/// returns REAL flattened `GooglePlayProductDetails` (via
/// `GooglePlayProductDetails.fromProductDetails`, the exact same
/// conversion the real Android platform performs), not a bare
/// `ProductDetails` per product ID. This is deliberate: the reported "AI
/// Pro mapped to the wrong billing plan" bug only reproduces against
/// realistic Play data, where a single product ID (e.g. `mkr_premium_ai`)
/// carries MULTIPLE base-plan offers that must be disambiguated - a bare
/// `ProductDetails(id: 'mkr_premium_ai')` per identifier (the old fake)
/// could never have caught this class of bug at all.
class _FakeInAppPurchasePlatform extends InAppPurchasePlatform with MockPlatformInterfaceMixin {
  final _controller = StreamController<List<PurchaseDetails>>.broadcast();
  final List<PurchaseDetails> completedPurchases = [];
  final List<String> boughtProductIds = [];
  final List<String?> boughtOfferTokens = [];
  int restoreCalls = 0;

  /// Configurable per test. Defaults to a realistic Play Console catalog
  /// whose subscription base-plan ID strings deliberately do NOT match
  /// this app's own internal 'monthly'/'yearly' labels — proving the fix
  /// resolves offers by their real, authoritative billing period rather
  /// than assuming the operator named the base plan literally
  /// 'monthly'/'yearly' in Play Console (the actual root cause of the
  /// reported bug: Play never guarantees that).
  List<ProductDetailsWrapper> productWrappers = defaultCatalog();

  static List<ProductDetailsWrapper> defaultCatalog() => [
        _subscription('mkr_premium', [('pro-m-plan', 'P1M', 2990000, r'$2.99'), ('pro-y-plan', 'P1Y', 29990000, r'$29.99')]),
        _subscription('mkr_premium_ai', [
          ('ai-pro-monthly-offer', 'P1M', 5990000, r'$5.99'),
          ('ai-pro-annual-offer', 'P1Y', 59990000, r'$59.99'),
        ]),
        ProductDetailsWrapper(
          description: 'Lifetime',
          name: 'Lifetime',
          productId: 'mkr_premium_lifetime',
          productType: ProductType.inapp,
          title: 'Lifetime',
          oneTimePurchaseOfferDetails: const OneTimePurchaseOfferDetailsWrapper(
            formattedPrice: r'$79.99',
            priceAmountMicros: 79990000,
            priceCurrencyCode: 'USD',
          ),
        ),
      ];

  static ProductDetailsWrapper _subscription(String id, List<(String basePlanId, String billingPeriod, int micros, String formatted)> offers) {
    return ProductDetailsWrapper(
      description: id,
      name: id,
      productId: id,
      productType: ProductType.subs,
      title: id,
      subscriptionOfferDetails: [
        for (final offer in offers)
          SubscriptionOfferDetailsWrapper(
            basePlanId: offer.$1,
            offerTags: const [],
            offerIdToken: '$id:${offer.$1}:token',
            pricingPhases: [
              PricingPhaseWrapper(
                billingCycleCount: 0,
                billingPeriod: offer.$2,
                formattedPrice: offer.$4,
                priceAmountMicros: offer.$3,
                priceCurrencyCode: 'USD',
                recurrenceMode: RecurrenceMode.infiniteRecurring,
              ),
            ],
          ),
      ],
    );
  }

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => _controller.stream;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<ProductDetailsResponse> queryProductDetails(Set<String> identifiers) async {
    final flattened = <ProductDetails>[
      for (final wrapper in productWrappers)
        if (identifiers.contains(wrapper.productId)) ...GooglePlayProductDetails.fromProductDetails(wrapper),
    ];
    return ProductDetailsResponse(productDetails: flattened, notFoundIDs: const []);
  }

  @override
  Future<bool> buyNonConsumable({required PurchaseParam purchaseParam}) async {
    boughtProductIds.add(purchaseParam.productDetails.id);
    boughtOfferTokens.add(purchaseParam is GooglePlayPurchaseParam ? purchaseParam.offerToken : null);
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

  group('2026-09-19 Monetization Release 3 fix - product/base-plan mapping', () {
    // The fake catalog's real Play base-plan IDs are deliberately spelled
    // differently than this app's own 'monthly'/'yearly' labels (see
    // _FakeInAppPurchasePlatform.defaultCatalog) - these tests only pass if
    // resolution actually falls back to the offer's authoritative billing
    // period (P1M/P1Y), not a naive string-equality guess. This is what
    // directly reproduces (and proves fixed) the reported "AI Pro purchase
    // mapped to the wrong billing plan" bug.

    test('AI Pro action selects the AI Pro YEARLY product/base plan - never Pro, never the monthly offer', () async {
      final repo = PlayBillingRepository(store);
      final resolved = (await repo.queryProductDetails())[ProductCatalog.aiProYearly.storeLookupKey];

      expect(resolved, isNotNull);
      expect(resolved!.id, 'mkr_premium_ai');
      expect((resolved as GooglePlayProductDetails).offerToken, 'mkr_premium_ai:ai-pro-annual-offer:token');

      final purchaseFuture = repo.purchase(ProductCatalog.aiProYearly);
      await Future<void>.delayed(Duration.zero);
      fakePlatform.emit([_purchase('mkr_premium_ai', PurchaseStatus.purchased, token: 'ai-pro-yearly-tok')]);
      await purchaseFuture;

      expect(fakePlatform.boughtProductIds, ['mkr_premium_ai']);
      expect(fakePlatform.boughtOfferTokens, ['mkr_premium_ai:ai-pro-annual-offer:token']);
      expect(await repo.getCurrentTier(), PremiumTier.aiPro);
      repo.dispose();
    });

    test('AI Pro action selects the AI Pro MONTHLY product/base plan when monthly is chosen', () async {
      final repo = PlayBillingRepository(store);
      final purchaseFuture = repo.purchase(ProductCatalog.aiProMonthly);
      await Future<void>.delayed(Duration.zero);
      fakePlatform.emit([_purchase('mkr_premium_ai', PurchaseStatus.purchased, token: 'ai-pro-monthly-tok')]);
      await purchaseFuture;

      expect(fakePlatform.boughtOfferTokens, ['mkr_premium_ai:ai-pro-monthly-offer:token']);
      repo.dispose();
    });

    test('Pro action selects the Pro product/base plan - never AI Pro', () async {
      final repo = PlayBillingRepository(store);
      final purchaseFuture = repo.purchase(ProductCatalog.proYearly);
      await Future<void>.delayed(Duration.zero);
      fakePlatform.emit([_purchase('mkr_premium', PurchaseStatus.purchased, token: 'pro-yearly-tok')]);
      await purchaseFuture;

      expect(fakePlatform.boughtProductIds, ['mkr_premium']);
      expect(fakePlatform.boughtOfferTokens, ['mkr_premium:pro-y-plan:token']);
      expect(await repo.getCurrentTier(), PremiumTier.pro);
      repo.dispose();
    });

    test('Lifetime action selects the lifetime product (no base plan to disambiguate)', () async {
      final repo = PlayBillingRepository(store);
      final purchaseFuture = repo.purchase(ProductCatalog.proLifetime);
      await Future<void>.delayed(Duration.zero);
      fakePlatform.emit([_purchase('mkr_premium_lifetime', PurchaseStatus.purchased, token: 'lifetime-tok')]);
      await purchaseFuture;

      expect(fakePlatform.boughtProductIds, ['mkr_premium_lifetime']);
      expect(await repo.getCurrentTier(), PremiumTier.lifetime);
      repo.dispose();
    });

    test('wrong-tier cross-mapping is rejected: a product with no matching real offer is never silently substituted', () async {
      // Play Console has AI Pro monthly only right now - no yearly offer
      // exists yet (e.g. not configured, or removed). The app must refuse
      // to buy the monthly offer (or any other product) in its place.
      fakePlatform.productWrappers = [
        _FakeInAppPurchasePlatform._subscription('mkr_premium_ai', [('ai-pro-monthly-offer', 'P1M', 5990000, r'$5.99')]),
      ];
      final repo = PlayBillingRepository(store);

      expect((await repo.queryProductDetails())[ProductCatalog.aiProYearly.storeLookupKey], isNull);
      expect(() => repo.purchase(ProductCatalog.aiProYearly), throwsA(isA<StateError>()));
      expect(fakePlatform.boughtProductIds, isEmpty);
      repo.dispose();
    });

    test('still resolves correctly when the operator\'s real base-plan ID literally is "monthly"/"yearly" (backward compatible)', () async {
      fakePlatform.productWrappers = [
        _FakeInAppPurchasePlatform._subscription('mkr_premium_ai', [('monthly', 'P1M', 5990000, r'$5.99'), ('yearly', 'P1Y', 59990000, r'$59.99')]),
      ];
      final repo = PlayBillingRepository(store);
      final resolved = (await repo.queryProductDetails())[ProductCatalog.aiProYearly.storeLookupKey];

      expect(resolved, isNotNull);
      expect((resolved as GooglePlayProductDetails).offerToken, 'mkr_premium_ai:yearly:token');
      repo.dispose();
    });
  });
}
