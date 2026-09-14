import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../domain/push_notification_service.dart';

/// Handles a message delivered while the app is fully backgrounded or
/// terminated. Must be a TOP-LEVEL (or static) function annotated exactly
/// like this — FCM invokes it in its own background isolate, which the
/// Dart tree-shaker would otherwise strip since nothing in the main
/// isolate appears to call it.
///
/// The system already shows the notification itself natively before any
/// Dart code here runs (a standard notification-type FCM message, which is
/// all MKR's Alert Engine sends — see backend/src/push/fcm-provider.ts).
/// This handler intentionally does no extra work: it cannot safely touch
/// Supabase (a background isolate has no restored user session) and
/// notification_logs is already written server-side by the Alert Engine,
/// never the client — writing anything here would risk a duplicate,
/// client-fabricated history entry the spec explicitly forbids. It exists
/// only because `FirebaseMessaging.onBackgroundMessage` requires a handler
/// to be registered at all for background delivery to work correctly.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}

/// Pure mapping, exposed for testing — [RemoteMessage]/[RemoteNotification]
/// are plain constructible data classes (no platform channel involved), so
/// this specific piece of logic is directly unit-testable even though the
/// rest of this class requires a real Firebase runtime.
@visibleForTesting
PushMessage toPushMessage(RemoteMessage message) {
  final notification = message.notification;
  return PushMessage(title: notification?.title ?? '', body: notification?.body ?? '', data: message.data);
}

/// Real FCM-backed [PushNotificationService]. Only ever constructed once
/// `Firebase.apps` is non-empty (see lib/app/app.dart) — i.e.
/// `android/app/google-services.json` was present and
/// `Firebase.initializeApp()` succeeded at startup — so [isAvailable] is
/// unconditionally `true` here; an unconfigured install keeps using
/// [NoopPushNotificationService] instead of this class entirely.
class FirebaseMessagingPushService implements PushNotificationService {
  FirebaseMessagingPushService({FirebaseMessaging? messaging}) : _messaging = messaging ?? FirebaseMessaging.instance;

  final FirebaseMessaging _messaging;

  // Guards against AuthController calling initialize() again on every
  // login within the same app session (see _registerDeviceIfPossible) —
  // without this, each login would add a duplicate onMessage/
  // onMessageOpenedApp listener, delivering every future message N times.
  bool _initialized = false;

  final StreamController<PushMessage> _foregroundController = StreamController<PushMessage>.broadcast();
  final StreamController<PushMessage> _tapController = StreamController<PushMessage>.broadcast();

  @override
  bool get isAvailable => true;

  @override
  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    // Never cancelled - this service is a single, app-lifetime Provider
    // (see lib/app/app.dart), same as every other long-lived service in
    // this app; there is no narrower scope to tear these down at.
    FirebaseMessaging.onMessage.listen((message) => _foregroundController.add(toPushMessage(message)));
    FirebaseMessaging.onMessageOpenedApp.listen((message) => _tapController.add(toPushMessage(message)));

    // A tap that launched the app from fully TERMINATED (as opposed to
    // background -> foreground, which onMessageOpenedApp above already
    // covers) surfaces here instead — fold it into the same tap stream so
    // callers only ever need one subscription.
    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) _tapController.add(toPushMessage(initialMessage));
  }

  /// FCM Correction Task Finding 2: `AuthController` calls this on every
  /// login/restore/register (see `_registerDeviceIfPossible`), which would
  /// otherwise mean re-invoking the native permission-request channel call
  /// every single time even once the user has already answered. Idempotent
  /// using the PLATFORM's own live authorization state
  /// (`getNotificationSettings()`) rather than any app-persisted flag -
  /// no custom persistence invented, and it can never go stale (unlike a
  /// cached bool, a system-settings change - e.g. the user later grants
  /// notifications from Android Settings - is reflected immediately since
  /// this queries fresh every call).
  ///
  /// Only `notDetermined` (never asked) and `denied` genuinely still call
  /// the real `requestPermission()` - per the platform interface's own
  /// documented semantics, a plain `denied` result "may still show another
  /// permission prompt" on Android and its own docs say to prefer calling
  /// `requestPermission()` again over sending the user to system settings.
  /// `authorized`/`provisional` are already resolved positively (nothing
  /// to gain by asking again) and `deniedPermanently` means the OS will
  /// never show another prompt at all (Android 13+: the user must grant it
  /// from system settings themselves) - both skip the native call outright.
  @override
  Future<bool> requestPermission() async {
    final current = await _messaging.getNotificationSettings();
    switch (current.authorizationStatus) {
      case AuthorizationStatus.authorized:
      case AuthorizationStatus.provisional:
        return true;
      case AuthorizationStatus.deniedPermanently:
        return false;
      case AuthorizationStatus.denied:
      case AuthorizationStatus.notDetermined:
        final settings = await _messaging.requestPermission();
        return settings.authorizationStatus == AuthorizationStatus.authorized || settings.authorizationStatus == AuthorizationStatus.provisional;
    }
  }

  @override
  Future<String?> getToken() => _messaging.getToken();

  @override
  Future<void> registerDevice() async {
    // Intentionally a no-op — registration is owned by AuthController,
    // which calls DeviceRepository.registerDevice directly with the token
    // from getToken()/onTokenRefresh (see push_notification_service.dart's
    // interface doc). This method stays on the interface for a future
    // transport that needs an explicit registration step (e.g. a topic
    // subscription); FCM's per-device token doesn't require one.
  }

  @override
  Future<void> unregisterDevice() async {
    // Revokes the current FCM token outright (not merely marking the
    // Supabase row inactive, which AuthController.logout already does via
    // DeviceRepository.deactivateDevice) — the next getToken() call mints
    // a fresh one. This is what actually guarantees a signed-out token can
    // never be mistaken for a still-active one belonging to this install,
    // even before any server-side check runs (spec: sign-out must not
    // leave an active token incorrectly associated with the wrong user).
    await _messaging.deleteToken();
  }

  @override
  Stream<PushMessage> get onForegroundMessage => _foregroundController.stream;

  @override
  Stream<PushMessage> get onNotificationTap => _tapController.stream;

  @override
  Stream<String> get onTokenRefresh => _messaging.onTokenRefresh;
}
