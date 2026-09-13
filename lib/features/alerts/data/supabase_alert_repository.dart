import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../../core/persistence/app_local_store.dart';
import '../../auth/application/auth_controller.dart';
import '../domain/alert.dart';
import '../domain/alert_repository.dart';

/// Real Supabase-backed [AlertRepository]. Cloud is authoritative for
/// PRICE_ABOVE/PRICE_BELOW alerts only — Supabase's `alerts` table has a
/// `condition_type in ('price_above','price_below')` CHECK constraint, so
/// percentage/event/radar alerts can never live there by design (matching
/// [SupabaseAlertCloudSync]'s existing scope decision). Every read merges
/// fresh cloud price-alerts with whatever non-price alerts exist locally;
/// every write updates the local cache (the actual cloud *push* on
/// mutation is a separate concern already handled by
/// [SupabaseAlertCloudSync], wired into `AlertsController._persist()`).
///
/// Falls back to the local cache alone for a guest or when Supabase is
/// briefly unreachable — alerts must keep working offline.
class SupabaseAlertRepository implements AlertRepository {
  SupabaseAlertRepository(this._store, this._auth);

  final AppLocalStore _store;
  final AuthController _auth;

  sb.SupabaseClient get _client => sb.Supabase.instance.client;

  bool get _isLoggedIn => _auth.profile != null && _auth.profile!.isGuest == false;

  List<Alert> _localAlerts() {
    final raw = _store.alertsJson;
    return raw == null ? const [] : raw.map(Alert.fromJson).toList();
  }

  @override
  Future<List<Alert>> getAlerts() async {
    final local = _localAlerts();
    if (!_isLoggedIn) return local;

    final userId = _auth.profile!.id;
    try {
      await _mergeLocalPriceAlertsOnce(userId, local);

      final rows = await _client.from('alerts').select().eq('user_id', userId);
      final cloudPriceAlerts = (rows as List).map((r) => _fromRow(r as Map<String, dynamic>)).toList();
      // Cloud is authoritative for price alerts; non-price alerts can only
      // ever live locally (see class doc), so they pass through unchanged.
      final nonPriceLocal = local.where((a) => a.type != AlertType.price).toList();
      final merged = [...cloudPriceAlerts, ...nonPriceLocal];
      await _store.setAlertsJson(merged.map((a) => a.toJson()).toList()); // offline cache
      return merged;
    } catch (_) {
      return local;
    }
  }

  @override
  Future<void> saveAlerts(List<Alert> alerts) async {
    await _store.setAlertsJson(alerts.map((a) => a.toJson()).toList());
  }

  /// Pushes any locally-known (e.g. created while a guest) price alerts up
  /// to the cloud exactly once per user per device — mirrors
  /// [SupabaseWatchlistRepository]'s `_mergeLocalOnce`, so a guest's alerts
  /// aren't lost on first login but also never get re-pushed (and
  /// resurrect a since-deleted alert) on every later login.
  Future<void> _mergeLocalPriceAlertsOnce(String userId, List<Alert> local) async {
    if (_store.alertsMergedForUser == userId) return;

    final localPriceAlerts = local.where((a) => a.type == AlertType.price && a.priceTarget != null && a.priceDirection != null).toList();
    if (localPriceAlerts.isNotEmpty) {
      await _client.from('alerts').upsert(
        [
          for (final alert in localPriceAlerts)
            {
              'user_id': userId,
              'client_id': alert.id,
              'symbol': alert.symbol,
              'condition_type': alert.priceDirection == PriceDirection.above ? 'price_above' : 'price_below',
              'target_value': alert.priceTarget,
              'enabled': alert.isEnabled,
              'last_triggered_at': alert.lastTriggeredAt?.toIso8601String(),
            },
        ],
        onConflict: 'user_id,client_id',
      );
    }
    await _store.setAlertsMergedForUser(userId);
  }

  Alert _fromRow(Map<String, dynamic> row) {
    return Alert(
      id: row['client_id'] as String? ?? row['id'] as String,
      type: AlertType.price,
      symbol: row['symbol'] as String,
      isEnabled: row['enabled'] as bool? ?? true,
      createdAt: DateTime.tryParse(row['created_at'] as String? ?? '') ?? DateTime.now(),
      priceTarget: (row['target_value'] as num).toDouble(),
      priceDirection: row['condition_type'] == 'price_above' ? PriceDirection.above : PriceDirection.below,
      lastTriggeredAt: row['last_triggered_at'] != null ? DateTime.tryParse(row['last_triggered_at'] as String) : null,
    );
  }
}
