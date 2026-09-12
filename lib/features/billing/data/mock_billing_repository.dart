import '../../../core/persistence/app_local_store.dart';
import '../domain/billing_repository.dart';
import '../domain/entitlement.dart';
import '../domain/product.dart';

class MockBillingRepository implements BillingRepository {
  MockBillingRepository(this._store);

  final AppLocalStore _store;

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
    return product.tier;
  }

  @override
  Future<PremiumTier> restore() async {
    await Future.delayed(const Duration(milliseconds: 300));
    return getCurrentTier();
  }
}
