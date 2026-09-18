import 'dart:async';

import 'package:flutter/foundation.dart';

import '../domain/billing_repository.dart';
import '../domain/entitlement.dart';
import '../domain/product.dart';

class EntitlementController extends ChangeNotifier {
  EntitlementController(this._repository) {
    _load();
    // 2026-09-17 AdMob + Billing task: a real purchase can resolve well
    // after this controller's own purchase()/restore() call already
    // returned (Play redelivering an unacknowledged purchase on cold
    // start, or refreshFromStore()'s bounded restore window completing
    // later) - this is the one place that ever applies such a change.
    _entitlementSubscription = _repository.entitlementChanges.listen((tier) {
      _entitlement = Entitlement(tier);
      notifyListeners();
    });
  }

  final BillingRepository _repository;
  StreamSubscription<PremiumTier>? _entitlementSubscription;

  Entitlement _entitlement = const Entitlement(PremiumTier.free);
  Entitlement get entitlement => _entitlement;

  bool _loading = true;
  bool get isLoading => _loading;

  Future<void> _load() async {
    final tier = await _repository.getCurrentTier();
    _entitlement = Entitlement(tier);
    _loading = false;
    notifyListeners();
    // Non-blocking: shows the fast local/cached tier immediately (works
    // offline), then re-validates against Play's own purchase records -
    // "restore/query as source of truth", never the local flag alone. Any
    // correction (up OR down) arrives via entitlementChanges above.
    unawaited(_repository.refreshFromStore());
  }

  /// Called on app resume (see `app.dart`'s `didChangeAppLifecycleState`)
  /// so a subscription that lapsed/was purchased on another device while
  /// this app was backgrounded is caught promptly, not just at cold start.
  Future<void> refresh() => _repository.refreshFromStore();

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

  @override
  void dispose() {
    _entitlementSubscription?.cancel();
    _repository.dispose();
    super.dispose();
  }
}
