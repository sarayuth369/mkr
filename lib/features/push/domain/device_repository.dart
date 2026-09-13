/// Persists a device's push token against the current user (spec 2.3-J).
/// [NoopDeviceRepository] is the default — writing a device row requires
/// both a real push token (see [PushNotificationService]) and a logged-in
/// user with Supabase configured, neither of which exist by default.
abstract class DeviceRepository {
  /// [userId] is passed explicitly by the caller (already holds the current
  /// session) rather than this repository looking it up itself - keeps the
  /// data layer from depending back on the application-layer AuthController.
  Future<void> registerDevice({required String userId, required String token, required String platform, required String appVersion});

  /// Marks the device inactive rather than deleting it, so notification
  /// history referencing it stays valid (spec: "logout: deactivate device
  /// token").
  Future<void> deactivateDevice(String token);
}

class NoopDeviceRepository implements DeviceRepository {
  const NoopDeviceRepository();

  @override
  Future<void> registerDevice({required String userId, required String token, required String platform, required String appVersion}) async {}

  @override
  Future<void> deactivateDevice(String token) async {}
}
