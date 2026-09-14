/// Push transport abstraction (spec 2.3-G/H) — Firebase Cloud Messaging is
/// the intended implementation for Android, but nothing in this interface
/// names FCM specifically, so a different transport could implement it
/// later without touching call sites.
///
/// [NoopPushNotificationService] is the only implementation shipped today:
/// adding a real `firebase_messaging`-backed one requires
/// `android/app/google-services.json` and a Firebase project, which this
/// codebase must never fabricate (see docs/MKR-EXTERNAL-INTEGRATIONS.md for
/// exactly what the product owner needs to supply). Every method here is
/// safe to call in that not-yet-configured state — it just does nothing
/// and reports itself as unavailable, never fakes success.
abstract class PushNotificationService {
  /// Whether this implementation can actually deliver push (i.e. Firebase
  /// is really configured) — UI must check this before claiming push is on.
  bool get isAvailable;

  Future<void> initialize();

  Future<bool> requestPermission();

  /// The current device's push token, or `null` if unavailable/not yet
  /// granted/not configured — never a fabricated value.
  Future<String?> getToken();

  Future<void> registerDevice();

  Future<void> unregisterDevice();

  /// Fires when a push notification arrives while the app is in the
  /// foreground.
  Stream<PushMessage> get onForegroundMessage;

  /// Fires when the user taps a notification (from background/terminated).
  Stream<PushMessage> get onNotificationTap;

  /// Fires whenever the transport mints a new token for this install
  /// (rotation, app reinstall, cleared data, etc.) — the caller (see
  /// [AuthController]) must re-register it against [DeviceRepository] for
  /// the currently signed-in user, exactly like the initial [getToken]
  /// result. Empty for a transport that never rotates tokens on its own.
  Stream<String> get onTokenRefresh;
}

class PushMessage {
  const PushMessage({required this.title, required this.body, this.data = const {}});

  final String title;
  final String body;
  final Map<String, dynamic> data;
}
