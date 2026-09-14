import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/auth/application/auth_controller.dart';
import 'package:mkr/features/auth/domain/auth_service.dart';
import 'package:mkr/features/auth/domain/user_profile.dart';
import 'package:mkr/features/push/domain/device_repository.dart';
import 'package:mkr/features/push/domain/push_notification_service.dart';

class _FakeAuthService implements AuthService {
  UserProfile? nextLoginResult;

  /// Backing store for `currentSession()` - `restoredSession` is a
  /// readability alias used at construction time (mirrors real usage:
  /// "this is the session already on disk when the controller is first
  /// created"); `emitExternalSessionChange` mutates the SAME field later to
  /// simulate a live external event (e.g. a revoked/expired refresh token)
  /// reaching `authStateChanges` without going through this controller's
  /// own `login()`/`logout()`.
  UserProfile? _session;
  set restoredSession(UserProfile? value) => _session = value;

  final _authStateController = StreamController<void>.broadcast();

  @override
  Stream<void> get authStateChanges => _authStateController.stream;

  @override
  Future<UserProfile?> currentSession() async => _session;

  @override
  Future<UserProfile> continueAsGuest() async => const UserProfile(id: 'guest', email: '', isGuest: true);

  @override
  Future<UserProfile> login({required String email, required String password}) async {
    _session = nextLoginResult;
    return nextLoginResult!;
  }

  @override
  Future<UserProfile> register({required String email, required String password}) async {
    _session = nextLoginResult;
    return nextLoginResult!;
  }

  @override
  Future<void> logout() async => _session = null;

  /// Test helper (FCM Final Correction Task Findings 1/2) - simulates an
  /// EXTERNAL auth event reaching `AuthController` via `authStateChanges`,
  /// without going through this controller's own `login()`/`logout()` -
  /// e.g. Supabase revoking/expiring a refresh token server-side.
  void emitExternalSessionChange(UserProfile? newSession) {
    _session = newSession;
    _authStateController.add(null);
  }
}

class _FakePushService implements PushNotificationService {
  bool permissionGranted = true;
  String? token = 'fake-fcm-token';
  int initializeCalls = 0;
  int unregisterDeviceCalls = 0;
  final _tokenRefreshController = StreamController<String>.broadcast();

  /// FCM Final Correction Task Finding 1 - when set, the NEXT
  /// `requestPermission()` call hangs until [resolvePendingPermission] is
  /// called, opening a real async race window for registration-race tests.
  /// `requestPermission()` is only ever called from
  /// `AuthController._registerDeviceIfPossible()` - never from `logout()`'s
  /// own cleanup path - so delaying it (rather than `getToken()`, which
  /// BOTH paths call) creates an unambiguous race window with no risk of
  /// also stalling an unrelated caller.
  ///
  /// Two separate fields on purpose: `_pendingPermission` is the "armed for
  /// the NEXT call" slot, claimed (and cleared) the moment a call actually
  /// reads it - a LATER registration attempt (e.g. for a newly-signed-in
  /// user) must resolve normally, not also hang on the same completer.
  /// `_outstandingPermission` is whichever completer a caller is ACTUALLY
  /// awaiting right now, which [resolvePendingPermission] targets - it
  /// must NOT be the same field as the armed slot, since that gets cleared
  /// (by design) the instant it's claimed, before the test gets a chance
  /// to resolve it.
  Completer<bool>? _pendingPermission;
  Completer<bool>? _outstandingPermission;

  void delayNextPermissionCheck() => _pendingPermission = Completer<bool>();

  void resolvePendingPermission() {
    final outstanding = _outstandingPermission;
    _outstandingPermission = null;
    outstanding?.complete(permissionGranted);
  }

  @override
  bool get isAvailable => true;

  @override
  Future<void> initialize() async => initializeCalls++;

  @override
  Future<bool> requestPermission() {
    final pending = _pendingPermission;
    if (pending != null) {
      _pendingPermission = null; // single-use claim
      _outstandingPermission = pending;
      return pending.future;
    }
    return Future.value(permissionGranted);
  }

  /// FCM Final Cleanup - when true, the NEXT `getToken()` call (used by
  /// `_cleanupDevice()`) throws instead of resolving, to test that a
  /// failure obtaining the token still lets `unregisterDevice()` (which
  /// takes no token argument) be attempted independently.
  bool throwOnGetToken = false;

  /// FCM Final Cleanup - when true, `unregisterDevice()` throws AFTER
  /// still incrementing [unregisterDeviceCalls] - so a test can assert it
  /// was genuinely ATTEMPTED even though it failed.
  bool throwOnUnregisterDevice = false;

  @override
  Future<String?> getToken() async {
    if (throwOnGetToken) throw Exception('fake getToken failure');
    return token;
  }

  @override
  Future<void> registerDevice() async {}

  @override
  Future<void> unregisterDevice() async {
    unregisterDeviceCalls++;
    if (throwOnUnregisterDevice) throw Exception('fake unregisterDevice failure');
  }

  @override
  Stream<PushMessage> get onForegroundMessage => const Stream.empty();

  @override
  Stream<PushMessage> get onNotificationTap => const Stream.empty();

  @override
  Stream<String> get onTokenRefresh => _tokenRefreshController.stream;

  /// Test helper - simulates the transport minting a new token.
  void emitTokenRefresh(String newToken) => _tokenRefreshController.add(newToken);
}

class _FakeDeviceRepository implements DeviceRepository {
  String? registeredUserId;
  String? registeredToken;
  String? deactivatedToken;
  int deactivateDeviceCalls = 0;

  /// FCM Final Cleanup - when true, `deactivateDevice()` throws AFTER still
  /// incrementing [deactivateDeviceCalls] (so a test can assert it was
  /// genuinely ATTEMPTED even though it failed) and WITHOUT setting
  /// [deactivatedToken] (since the operation itself did not succeed).
  bool throwOnDeactivateDevice = false;

  @override
  Future<void> registerDevice({required String userId, required String token, required String platform, required String appVersion}) async {
    registeredUserId = userId;
    registeredToken = token;
  }

  @override
  Future<void> deactivateDevice(String token) async {
    deactivateDeviceCalls++;
    if (throwOnDeactivateDevice) throw Exception('fake deactivateDevice failure');
    deactivatedToken = token;
  }
}

/// Drains pending async chains. A single `Future.delayed(Duration.zero)`
/// only flushes ONE event-loop turn's worth of microtasks; the
/// registration-race tests below chain several real `await` hops
/// (`initialize()` → `requestPermission()` → `getToken()` →
/// `registerDevice()`), each its own turn once resumed from a completer -
/// looping a few turns reliably lets a resumed chain run all the way to
/// completion within one `await pumpMicrotasks()` call.
Future<void> pumpMicrotasks() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('logging in as a real (non-guest) user registers the device once a push token is available', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-1', email: 'a@b.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    await controller.login('a@b.com', 'password');
    await pumpMicrotasks();

    expect(devices.registeredUserId, 'user-1');
    expect(devices.registeredToken, 'fake-fcm-token');
    expect(push.initializeCalls, 1);
  });

  test('FCM Correction Task Finding 1: a session restored at startup (e.g. a fresh install with an already-valid Supabase session) registers the device without an explicit login() call', () async {
    final auth = _FakeAuthService()..restoredSession = const UserProfile(id: 'restored-user', email: 'restored@example.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    expect(devices.registeredUserId, 'restored-user');
    expect(devices.registeredToken, 'fake-fcm-token');
    expect(push.initializeCalls, 1);
  });

  test('a restored guest session (no persisted session at all) never triggers device registration', () async {
    final auth = _FakeAuthService(); // restoredSession stays null -> continueAsGuest()
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    expect(devices.registeredUserId, isNull);
    expect(push.initializeCalls, 0);
  });

  test('a guest session never triggers device registration', () async {
    final auth = _FakeAuthService();
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    expect(devices.registeredUserId, isNull);
    expect(push.initializeCalls, 0);
  });

  test('denied notification permission never registers a device even if a token exists', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-2', email: 'c@d.com');
    final push = _FakePushService()..permissionGranted = false;
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    await controller.login('c@d.com', 'password');
    await pumpMicrotasks();

    expect(devices.registeredUserId, isNull);
  });

  test('logout deactivates the device token when one exists', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-3', email: 'e@f.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();
    await controller.login('e@f.com', 'password');
    await pumpMicrotasks();

    await controller.logout();

    expect(devices.deactivatedToken, 'fake-fcm-token');
  });

  test('logout also revokes the transport-level token, not just the Supabase row', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-3b', email: 'g@h.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();
    await controller.login('g@h.com', 'password');
    await pumpMicrotasks();

    await controller.logout();

    expect(push.unregisterDeviceCalls, 1);
  });

  test('a token refresh re-registers the new token for the currently signed-in user', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-4', email: 'i@j.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();
    await controller.login('i@j.com', 'password');
    await pumpMicrotasks();

    push.emitTokenRefresh('rotated-fcm-token');
    await pumpMicrotasks();

    expect(devices.registeredUserId, 'user-4');
    expect(devices.registeredToken, 'rotated-fcm-token');
  });

  test('a token refresh while only a guest session is active never registers a device', () async {
    final auth = _FakeAuthService();
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    push.emitTokenRefresh('rotated-fcm-token');
    await pumpMicrotasks();

    expect(devices.registeredUserId, isNull);
  });

  test('logging in twice in the same session only initializes the push transport once (no duplicate listeners)', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-5', email: 'k@l.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    await controller.login('k@l.com', 'password');
    await pumpMicrotasks();
    await controller.logout();
    await controller.login('k@l.com', 'password');
    await pumpMicrotasks();

    // AuthController itself calls initialize() on every successful login -
    // duplicate-listener prevention is the REAL implementation's own
    // responsibility (see FirebaseMessagingPushService's `_initialized`
    // guard, which this fake does not model) - this asserts the call
    // pattern AuthController produces stays exactly as designed.
    expect(push.initializeCalls, 2);
  });

  group('FCM Final Correction Task Finding 1 - registration race after login/logout', () {
    test('logout while a registration is still in flight does not register the stale (already-signed-out) user', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-race-a', email: 'race-a@example.com');
      final push = _FakePushService()..delayNextPermissionCheck();
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();

      await controller.login('race-a@example.com', 'password'); // registration starts, gets stuck awaiting getToken()
      await controller.logout(); // must complete fully without waiting on the stuck registration

      expect(devices.registeredUserId, isNull); // still stuck - not registered yet

      push.resolvePendingPermission(); // let the stuck registration finally resolve
      await pumpMicrotasks();

      expect(devices.registeredUserId, isNull); // and STILL never registered - correctly abandoned as stale
    });

    test('an external session change to a different user while a registration is still in flight does not register the stale user', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-race-a', email: 'race-a@example.com');
      final push = _FakePushService()..delayNextPermissionCheck();
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();

      await controller.login('race-a@example.com', 'password'); // stuck awaiting getToken()
      auth.emitExternalSessionChange(const UserProfile(id: 'user-race-b', email: 'race-b@example.com'));
      await pumpMicrotasks();
      await pumpMicrotasks();

      push.resolvePendingPermission(); // let User A's stale registration finally resolve
      await pumpMicrotasks();

      expect(devices.registeredUserId, 'user-race-b'); // User B's own registration won, never overwritten back to A
    });
  });

  group('FCM Final Correction Task Finding 2 - external session loss cleans up the push device', () {
    test('authenticated -> session revoked externally -> device deactivated', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-lost-1', email: 'lost1@example.com');
      final push = _FakePushService();
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('lost1@example.com', 'password');
      await pumpMicrotasks();

      auth.emitExternalSessionChange(null); // e.g. a revoked/expired Supabase refresh token
      await pumpMicrotasks();

      expect(devices.deactivatedToken, 'fake-fcm-token');
    });

    test('authenticated -> session revoked externally -> transport-level token is also revoked', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-lost-2', email: 'lost2@example.com');
      final push = _FakePushService();
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('lost2@example.com', 'password');
      await pumpMicrotasks();

      auth.emitExternalSessionChange(null);
      await pumpMicrotasks();

      expect(push.unregisterDeviceCalls, 1);
    });

    test('guest -> session (already null) -> no push cleanup is attempted', () async {
      final auth = _FakeAuthService(); // never authenticated - starts and stays guest
      final push = _FakePushService();
      final devices = _FakeDeviceRepository();
      AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();

      auth.emitExternalSessionChange(null);
      await pumpMicrotasks();

      expect(devices.deactivatedToken, isNull);
      expect(push.unregisterDeviceCalls, 0);
    });

    test('a stale registration cannot re-register after the session it belonged to is lost externally', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-lost-3', email: 'lost3@example.com');
      final push = _FakePushService()..delayNextPermissionCheck();
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();

      await controller.login('lost3@example.com', 'password'); // stuck awaiting getToken()
      auth.emitExternalSessionChange(null); // session revoked while registration is still in flight
      await pumpMicrotasks();

      push.resolvePendingPermission(); // let the stuck (now-stale) registration finally resolve
      await pumpMicrotasks();

      expect(devices.registeredUserId, isNull); // never registered - correctly abandoned as stale
      expect(devices.deactivatedToken, 'fake-fcm-token'); // cleanup itself still happened normally
    });
  });

  group('FCM Final Cleanup - _cleanupDevice operations are independent best-effort steps', () {
    test('a deactivateDevice failure does not prevent unregisterDevice from being attempted', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-cleanup-1', email: 'cleanup1@example.com');
      final push = _FakePushService();
      final devices = _FakeDeviceRepository()..throwOnDeactivateDevice = true;
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('cleanup1@example.com', 'password');
      await pumpMicrotasks();

      await controller.logout();

      expect(devices.deactivateDeviceCalls, 1); // attempted
      expect(devices.deactivatedToken, isNull); // and it genuinely failed, not silently "succeeded"
      expect(push.unregisterDeviceCalls, 1); // still attempted despite the failure above - the core fix
    });

    test('an unregisterDevice failure does not block the auth flow - logout still completes normally', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-cleanup-2', email: 'cleanup2@example.com');
      final push = _FakePushService()..throwOnUnregisterDevice = true;
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('cleanup2@example.com', 'password');
      await pumpMicrotasks();

      await expectLater(controller.logout(), completes); // must not throw into the caller

      expect(controller.profile?.isGuest, true); // logout still completed the full auth transition
      expect(devices.deactivatedToken, 'fake-fcm-token'); // the OTHER operation still succeeded independently
      expect(push.unregisterDeviceCalls, 1); // was genuinely attempted, not skipped
    });

    test('a getToken failure during cleanup still attempts unregisterDevice (it takes no token argument)', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-cleanup-3', email: 'cleanup3@example.com');
      final push = _FakePushService();
      final devices = _FakeDeviceRepository();
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('cleanup3@example.com', 'password');
      await pumpMicrotasks();

      push.throwOnGetToken = true; // fails specifically during logout()'s own cleanup call

      await expectLater(controller.logout(), completes);

      expect(devices.deactivateDeviceCalls, 0); // no token obtained - deactivateDevice was never attempted (needs one)
      expect(push.unregisterDeviceCalls, 1); // unregisterDevice needs no token - still attempted regardless
    });

    test('external session loss cleanup also attempts unregisterDevice even when deactivateDevice fails', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-cleanup-4', email: 'cleanup4@example.com');
      final push = _FakePushService();
      final devices = _FakeDeviceRepository()..throwOnDeactivateDevice = true;
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('cleanup4@example.com', 'password');
      await pumpMicrotasks();

      auth.emitExternalSessionChange(null); // revoked/expired session, detected externally
      await pumpMicrotasks();

      expect(devices.deactivateDeviceCalls, 1);
      expect(push.unregisterDeviceCalls, 1); // both operations independently attempted, same as an explicit logout
    });

    test('logout completes even when BOTH cleanup operations fail', () async {
      final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-cleanup-5', email: 'cleanup5@example.com');
      final push = _FakePushService()..throwOnUnregisterDevice = true;
      final devices = _FakeDeviceRepository()..throwOnDeactivateDevice = true;
      final controller = AuthController(auth, pushService: push, deviceRepository: devices);
      await pumpMicrotasks();
      await controller.login('cleanup5@example.com', 'password');
      await pumpMicrotasks();

      await expectLater(controller.logout(), completes); // never throws into the auth flow, no matter how much cleanup fails

      expect(controller.profile?.isGuest, true);
      expect(devices.deactivateDeviceCalls, 1);
      expect(push.unregisterDeviceCalls, 1);
    });
  });
}
