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

/// Firebase initialization failure-state fix - a small, Firebase-independent
/// state machine for "run a two-phase async setup exactly once, ever,
/// sharing one in-flight attempt across concurrent callers, and allowing a
/// full retry if (and only if) it failed". Extracted as its own class
/// (rather than inlined into [FirebaseMessagingPushService.initialize])
/// specifically so its retry/concurrency/idempotency behavior is directly
/// unit-testable with plain fake callbacks - no Firebase SDK/platform
/// channel involved at all.
///
/// - [phase1] runs AT MOST ONCE, ever, regardless of how many times [run]
///   is called or how many later attempts fail - once it completes, it is
///   never re-invoked. This is what prevents a retry after a later failure
///   from attaching duplicate listeners: listener registration belongs in
///   [phase1], never [phase2].
/// - [phase2] is retried on every fresh attempt until it succeeds - this is
///   what recovers from a transient failure (e.g. `getInitialMessage()`
///   throwing) without needing anything Firebase-specific.
/// - The whole operation is only considered permanently done once BOTH
///   phases have completed without throwing; until then, [run] always
///   returns a live (possibly freshly-started) attempt rather than a
///   cached failure.
/// - Concurrent callers within the same in-flight attempt share the exact
///   same [Future] (and therefore the same outcome) - [phase1]/[phase2] are
///   never invoked more than once per attempt no matter how many callers
///   are awaiting it.
@visibleForTesting
class TwoPhaseInitGuard {
  bool _phase1Done = false;
  bool _succeeded = false;
  Future<void>? _inFlight;

  /// True once both phases have completed successfully at least once -
  /// permanent for the lifetime of this guard (there is no "un-succeed").
  bool get hasSucceeded => _succeeded;

  Future<void> run({required Future<void> Function() phase1, required Future<void> Function() phase2}) {
    if (_succeeded) return Future.value();
    return _inFlight ??= _runOnce(phase1: phase1, phase2: phase2);
  }

  Future<void> _runOnce({required Future<void> Function() phase1, required Future<void> Function() phase2}) async {
    try {
      if (!_phase1Done) {
        await phase1();
        _phase1Done = true; // permanent - never re-run, even if phase2 fails on this or a later attempt
      }
      await phase2();
      _succeeded = true;
    } finally {
      // Cleared unconditionally: on success, [run]'s `_succeeded` check
      // above makes this moot for future callers anyway; on failure, this
      // is what allows the NEXT `initialize()` call to start a fresh
      // attempt instead of being stuck sharing a already-failed Future.
      _inFlight = null;
    }
  }
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
  //
  // Firebase initialization failure-state fix: this used to be flipped to
  // `true` BEFORE the async sequence below had actually succeeded, so a
  // `getInitialMessage()` failure left the service permanently marked
  // initialized with no way to retry (the exception still correctly
  // propagated to AuthController's existing best-effort try/catch, but the
  // NEXT `initialize()` call would then immediately no-op forever, since
  // nothing ever reset the flag). Delegated to [TwoPhaseInitGuard], which
  // only reports success once the whole sequence has actually completed,
  // allows a full retry on failure, and shares one in-flight attempt
  // across concurrent callers so a retry (or two overlapping callers)
  // can never attach a second copy of the listeners.
  final TwoPhaseInitGuard _initGuard = TwoPhaseInitGuard();

  final StreamController<PushMessage> _foregroundController = StreamController<PushMessage>.broadcast();
  final StreamController<PushMessage> _tapController = StreamController<PushMessage>.broadcast();

  @override
  bool get isAvailable => true;

  @override
  Future<void> initialize() {
    return _initGuard.run(
      // Phase 1 - runs at most once, ever (see [TwoPhaseInitGuard]): a
      // retry after phase 2 fails below must never re-subscribe these,
      // which would otherwise deliver every future message N times.
      // Never explicitly cancelled - this service is a single, app-lifetime
      // Provider (see lib/app/app.dart), same as every other long-lived
      // service in this app; there is no narrower scope to tear these
      // down at.
      phase1: () async {
        FirebaseMessaging.onMessage.listen((message) => _foregroundController.add(toPushMessage(message)));
        FirebaseMessaging.onMessageOpenedApp.listen((message) => _tapController.add(toPushMessage(message)));
      },
      // Phase 2 - retried on every fresh attempt until it succeeds. A tap
      // that launched the app from fully TERMINATED (as opposed to
      // background -> foreground, which onMessageOpenedApp above already
      // covers) surfaces here instead — fold it into the same tap stream
      // so callers only ever need one subscription.
      phase2: () async {
        final initialMessage = await _messaging.getInitialMessage();
        if (initialMessage != null) _tapController.add(toPushMessage(initialMessage));
      },
    );
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
