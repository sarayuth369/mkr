import '../domain/push_notification_service.dart';

/// Fallback [PushNotificationService] — used whenever Firebase isn't
/// actually configured at runtime (`Firebase.apps` empty: no
/// `google-services.json`/Firebase project, or `Firebase.initializeApp()`
/// failed — see lib/app/app.dart, which otherwise wires in the real
/// `FirebaseMessagingPushService`). Every operation is a safe no-op;
/// [getToken] always returns `null` so nothing downstream (device
/// registration, Settings UI) can mistake this for a working push
/// transport.
class NoopPushNotificationService implements PushNotificationService {
  const NoopPushNotificationService();

  @override
  bool get isAvailable => false;

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<String?> getToken() async => null;

  @override
  Future<void> registerDevice() async {}

  @override
  Future<void> unregisterDevice() async {}

  @override
  Stream<PushMessage> get onForegroundMessage => const Stream.empty();

  @override
  Stream<PushMessage> get onNotificationTap => const Stream.empty();

  @override
  Stream<String> get onTokenRefresh => const Stream.empty();
}
