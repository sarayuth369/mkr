import 'package:flutter/foundation.dart';

import '../domain/billing_repository.dart';
import '../domain/entitlement.dart';
import '../domain/product.dart';

class EntitlementController extends ChangeNotifier {
  EntitlementController(this._repository) {
    _load();
  }

  final BillingRepository _repository;

  Entitlement _entitlement = const Entitlement(PremiumTier.free);
  Entitlement get entitlement => _entitlement;

  bool _loading = true;
  bool get isLoading => _loading;

  Future<void> _load() async {
    final tier = await _repository.getCurrentTier();
    _entitlement = Entitlement(tier);
    _loading = false;
    notifyListeners();
  }

  Future<void> purchase(Product product) async {
    final tier = await _repository.purchase(product);
    _entitlement = Entitlement(tier);
    notifyListeners();
  }

  Future<void> restore() async {
    final tier = await _repository.restore();
    _entitlement = Entitlement(tier);
    notifyListeners();
  }
}
