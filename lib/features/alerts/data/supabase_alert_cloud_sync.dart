import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../auth/application/auth_controller.dart';
import '../domain/alert.dart';
import '../domain/alert_cloud_sync.dart';

/// Real Supabase-backed [AlertCloudSync]. Best-effort, fire-and-forget by
/// design (see [AlertsController]'s call site) — a sync failure must never
/// block the local alert list from working.
class SupabaseAlertCloudSync implements AlertCloudSync {
  SupabaseAlertCloudSync(this._auth);

  final AuthController _auth;

  sb.SupabaseClient get _client => sb.Supabase.instance.client;
  bool get _isLoggedIn => _auth.profile != null && _auth.profile!.isGuest == false;

  @override
  Future<void> syncPriceAlerts(List<Alert> alerts) async {
    if (!_isLoggedIn) return;
    final userId = _auth.profile!.id;

    final priceAlerts = alerts.where((a) => a.type == AlertType.price && a.priceTarget != null && a.priceDirection != null).toList();

    try {
      // Replace-all-for-this-user strategy, upserted by (user_id, client_id)
      // so a re-sync of an already-known alert updates it in place.
      if (priceAlerts.isNotEmpty) {
        await _client.from('alerts').upsert(
              [
                for (final alert in priceAlerts)
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

      // Remove cloud rows for alerts no longer present locally (deleted, or
      // changed away from a price type) — keyed by client_id so a stale
      // Supabase-only row (e.g. from a since-uninstalled device) is left
      // alone rather than guessed at.
      final keepClientIds = priceAlerts.map((a) => a.id).toList();
      if (keepClientIds.isEmpty) {
        await _client.from('alerts').delete().eq('user_id', userId);
      } else {
        await _client.from('alerts').delete().eq('user_id', userId).not('client_id', 'in', '(${keepClientIds.join(',')})');
      }
    } catch (_) {
      // Offline or Supabase unreachable — local alerts remain the source of
      // truth for the app; the next successful sync catches up.
    }
  }
}
