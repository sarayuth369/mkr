import '../domain/push_notification_service.dart';

/// Default [PushNotificationService] — used whenever Firebase isn't
/// configured (always, until `google-services.json` + a Firebase project
/// exist). Every operation is a safe no-op; [getToken] always returns
/// `null` so nothing downstream (device registration, Settings UI) can
/// mistake this for a working push transport.
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
}
