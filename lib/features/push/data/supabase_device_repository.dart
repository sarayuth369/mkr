import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../domain/device_repository.dart';

/// Real Supabase-backed [DeviceRepository] (`devices` table — see
/// supabase/migrations/20260913000000_initial_schema.sql). Only ever
/// reached with a non-null token today if a future
/// `firebase_messaging`-backed [PushNotificationService] replaces
/// [NoopPushNotificationService] — see docs/MKR-EXTERNAL-INTEGRATIONS.md.
/// Takes no AuthController dependency (the caller already knows it's
/// dealing with a real, non-guest session and passes [userId] directly),
/// which also sidesteps a constructor cycle since AuthController itself
/// depends on a [DeviceRepository].
class SupabaseDeviceRepository implements DeviceRepository {
  const SupabaseDeviceRepository();

  sb.SupabaseClient get _client => sb.Supabase.instance.client;

  @override
  Future<void> registerDevice({required String userId, required String token, required String platform, required String appVersion}) async {
    try {
      await _client.from('devices').upsert(
        {
          'user_id': userId,
          'fcm_token': token,
          'platform': platform,
          'app_version': appVersion,
          'active': true,
        },
        onConflict: 'user_id,fcm_token',
      );
    } catch (_) {
      // Best-effort — push registration failing must never block app usage.
    }
  }

  @override
  Future<void> deactivateDevice(String token) async {
    try {
      await _client.from('devices').update({'active': false}).eq('fcm_token', token);
    } catch (_) {
      // Best-effort.
    }
  }
}
