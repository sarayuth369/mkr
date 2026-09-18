import 'dart:async';

import 'package:in_app_purchase/in_app_purchase.dart';

import '../../../core/persistence/app_local_store.dart';
import '../domain/billing_repository.dart';
import '../domain/entitlement.dart';
import '../domain/product.dart';

class MockBillingRepository implements BillingRepository {
  MockBillingRepository(this._store);

  final AppLocalStore _store;
  final _entitlementController = StreamController<PremiumTier>.broadcast();

  @override
  Future<PremiumTier> getCurrentTier() async {
    final raw = _store.entitlementTier;
    if (raw == null) return PremiumTier.free;
    return PremiumTier.values.byName(raw);
  }

  @override
  Future<PremiumTier> purchase(Product product) async {
    await Future.delayed(const Duration(milliseconds: 500));
    await _store.setEntitlementTier(product.tier.name);
    _entitlementController.add(product.tier);
    return product.tier;
  }

  @override
  Future<PremiumTier> restore() async {
    await Future.delayed(const Duration(milliseconds: 300));
    return getCurrentTier();
  }

  /// Demo mode/tests never talk to a real store - always empty, so callers
  /// fall back to [ProductCatalog]'s static display prices.
  @override
  Future<Map<String, ProductDetails>> queryProductDetails() async => {};

  /// Nothing to re-validate against without a real store - a no-op,
  /// matching this class's existing "never grants beyond an explicit
  /// purchase() call" contract.
  @override
  Future<void> refreshFromStore() async {}

  @override
  Stream<PremiumTier> get entitlementChanges => _entitlementController.stream;

  @override
  void dispose() => _entitlementController.close();
}
