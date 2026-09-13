import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../auth/application/auth_controller.dart';
import '../domain/notification_history.dart';

/// Reads a signed-in user's own `notification_logs` rows (RLS restricts
/// this to `user_id = auth.uid()` regardless of the explicit filter below -
/// see supabase/migrations/20260913000001_row_level_security.sql). Rows
/// only ever exist once a real Alert Engine + FCM push has actually fired
/// server-side; this class never fabricates history.
class SupabaseNotificationHistoryService implements NotificationHistoryService {
  SupabaseNotificationHistoryService(this._auth);

  final AuthController _auth;

  sb.SupabaseClient get _client => sb.Supabase.instance.client;

  @override
  bool get isConfigured => true;

  @override
  Future<List<NotificationHistoryEntry>> getRecent() async {
    final profile = _auth.profile;
    if (profile == null || profile.isGuest) return const [];
    try {
      final rows = await _client
          .from('notification_logs')
          .select('title, body, status, sent_at')
          .eq('user_id', profile.id)
          .order('sent_at', ascending: false)
          .limit(50);
      return (rows as List<dynamic>)
          .map(
            (row) => NotificationHistoryEntry(
              title: row['title'] as String? ?? '',
              body: row['body'] as String? ?? '',
              sentAt: DateTime.tryParse(row['sent_at'] as String? ?? '') ?? DateTime.now(),
              status: row['status'] == 'sent' ? NotificationDeliveryStatus.sent : NotificationDeliveryStatus.failed,
            ),
          )
          .toList();
    } catch (_) {
      return const [];
    }
  }
}
