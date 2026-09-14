/// Push transport abstraction (spec 2.3-G/H) — Firebase Cloud Messaging is
/// the implementation for Android (`FirebaseMessagingPushService`,
/// lib/features/push/data/firebase_push_notification_service.dart), but
/// nothing in this interface names FCM specifically, so a different
/// transport could implement it later without touching call sites.
///
/// [NoopPushNotificationService] is the fallback whenever Firebase isn't
/// actually configured (no `android/app/google-services.json`/Firebase
/// project, or `Firebase.initializeApp()` failed at startup — see
/// lib/app/app.dart) — every method here is safe to call in that state, it
/// just does nothing and reports itself as unavailable, never fakes
/// success. See docs/MKR-EXTERNAL-INTEGRATIONS.md for what's required to
/// provision Firebase in the first place.
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
