/// Production path: Flutter registers a device token → Cloudflare Worker →
/// push notification provider (FCM). [MockNotificationService] just surfaces
/// a local in-app signal in Phase 1.
abstract class NotificationService {
  Future<void> notify({required String title, required String body});
}
