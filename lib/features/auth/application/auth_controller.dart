import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/app_info.dart';
import '../../push/data/noop_push_notification_service.dart';
import '../../push/domain/device_repository.dart';
import '../../push/domain/push_notification_service.dart';
import '../domain/auth_service.dart';
import '../domain/user_profile.dart';

/// Registers/deactivates the device's push token around login/logout/restore
/// (spec 2.3-J). Both dependencies default to their Noop implementations
/// (a genuine no-op end to end, e.g. in tests or before a Firebase project
/// is provisioned) but the app itself now wires in the real
/// [PushNotificationService]/[DeviceRepository] implementations - see
/// lib/app/app.dart and docs/MKR-EXTERNAL-INTEGRATIONS.md. Never throws
/// into the caller: device registration is a best-effort enhancement, not
/// a login requirement.
///
/// Concurrency note (FCM Final Cleanup): an explicit [logout] and an
/// external session loss detected via [_syncFromService] could plausibly
/// both fire close together in a real app (e.g. [logout]'s own call into
/// [AuthService.logout] triggering [AuthService.authStateChanges] before
/// [logout] itself finishes reassigning [_profile]), resulting in
/// [_cleanupDevice] running twice for the same lost session. This is
/// intentionally NOT de-duplicated with a lock/queue (out of scope - see
/// the task's own "no redesign, no queue" constraint) because it doesn't
/// need to be: [_cleanupDevice]'s operations are independently
/// best-effort and safe to repeat (deactivating an already-inactive
/// device row, or revoking an already-revoked token, are both no-ops or
/// harmless failures, never a crash - see [_cleanupDevice]'s own doc), and
/// [_invalidateInFlightRegistration] is called on every path that can
/// trigger a cleanup, so no re-registration can land for the lost session
/// regardless of how many times cleanup itself runs.
class AuthController extends ChangeNotifier {
  AuthController(
    this._service, {
    PushNotificationService pushService = const NoopPushNotificationService(),
    DeviceRepository deviceRepository = const NoopDeviceRepository(),
  })  : _pushService = pushService,
        _deviceRepository = deviceRepository {
    _restore();
    _authStateSubscription = _service.authStateChanges?.listen((_) => _syncFromService());
    _tokenRefreshSubscription = _pushService.onTokenRefresh.listen(_onTokenRefresh);
  }

  final AuthService _service;
  final PushNotificationService _pushService;
  final DeviceRepository _deviceRepository;
  StreamSubscription<void>? _authStateSubscription;
  StreamSubscription<String>? _tokenRefreshSubscription;

  UserProfile? _profile;
  UserProfile? get profile => _profile;

  bool _loading = true;
  bool get isLoading => _loading;

  bool get isAuthenticated => _profile != null;

  /// FCM Final Correction Task Finding 1 - a "session epoch". Registration
  /// (`_registerDeviceIfPossible`) is a multi-step async operation
  /// (`initialize()` → `requestPermission()` → `getToken()` →
  /// `registerDevice()`), and the user can log out or the session can
  /// change while it's still in flight. Every place [_profile] changes to
  /// a DIFFERENT identity (a different user, or guest) bumps this via
  /// [_invalidateInFlightRegistration] BEFORE the reassignment; a
  /// registration attempt captures the epoch at its start and re-checks it
  /// immediately before the actual write, so a write that was already
  /// "in flight" when the identity changed is silently abandoned instead
  /// of registering a token against a session that is no longer current.
  int _sessionEpoch = 0;

  void _invalidateInFlightRegistration() => _sessionEpoch++;

  Future<void> _restore() async {
    _profile = await _service.currentSession();
    _profile ??= await _service.continueAsGuest();
    _loading = false;
    notifyListeners();
    // A fresh install/reinstall (or any cold start) can restore an
    // already-authenticated Supabase session while this device has never
    // registered its current FCM token - login()/register() aren't called
    // on this path, so without this the device would go unregistered until
    // an unrelated token-refresh event happened to fire later. Guest-safe
    // (same guard as every other call site) and best-effort - never
    // blocks/delays startup, since notifyListeners() above has already
    // unblocked the UI. No epoch bump needed here - this is the very first
    // assignment, nothing was "in flight" before it.
    if (_profile?.isGuest == false) unawaited(_registerDeviceIfPossible());
  }

  /// Re-syncs [profile] from [AuthService.currentSession] in response to an
  /// external auth event (see [AuthService.authStateChanges]) — e.g. a
  /// revoked/expired refresh token signing the user out server-side without
  /// this controller's own [logout] ever being called.
  Future<void> _syncFromService() async {
    if (_loading) return; // _restore() already owns the initial sync
    final updated = await _service.currentSession();
    if (updated == null) {
      if (_profile?.isGuest == false) {
        // FCM Final Correction Task Finding 2 - the session was lost
        // externally (never went through logout()), but the device row/
        // transport token this session may have registered must still be
        // cleaned up the same way an explicit logout would - otherwise a
        // revoked/expired session leaves an active-looking device behind
        // indefinitely. Invalidate BEFORE cleanup/reassignment so any
        // still-in-flight registration for this (now-lost) session aborts
        // rather than racing the cleanup below.
        _invalidateInFlightRegistration();
        await _cleanupDevice();
        _profile = await _service.continueAsGuest();
        notifyListeners();
      }
      return; // already guest - nothing registered, nothing to clean up
    }
    if (updated != _profile) {
      _invalidateInFlightRegistration();
      _profile = updated;
      notifyListeners();
      unawaited(_registerDeviceIfPossible());
    }
  }

  Future<void> login(String email, String password) async {
    _invalidateInFlightRegistration();
    _profile = await _service.login(email: email, password: password);
    notifyListeners();
    unawaited(_registerDeviceIfPossible());
  }

  Future<void> register(String email, String password) async {
    _invalidateInFlightRegistration();
    _profile = await _service.register(email: email, password: password);
    notifyListeners();
    unawaited(_registerDeviceIfPossible());
  }

  Future<void> _registerDeviceIfPossible() async {
    final profile = _profile;
    if (profile == null || profile.isGuest) return;
    final epoch = _sessionEpoch;
    try {
      await _pushService.initialize();
      if (!await _pushService.requestPermission()) return;
      final token = await _pushService.getToken();
      if (token == null) return;
      // FCM Final Correction Task Finding 1 - re-validate immediately
      // before the write: everything above this line is real async work
      // (native calls) the session could have changed underneath. `profile`
      // itself is also re-checked against the live [_profile] (value
      // equality, matching [_syncFromService]'s own `updated != _profile`
      // idiom - [UserProfile] defines `==` by id/email/isGuest), not just
      // the epoch counter, so this can never register a long-captured
      // profile that is no longer the active one even if some future edit
      // forgot to bump the epoch on a particular transition.
      if (epoch != _sessionEpoch || profile != _profile) return;
      await _deviceRepository.registerDevice(userId: profile.id, token: token, platform: 'android', appVersion: appVersion);
    } catch (_) {
      // Best-effort - a push registration failure must never affect login.
    }
  }

  /// Re-registers a rotated token (app reinstall, cleared data, periodic
  /// FCM rotation, etc.) against whichever user is CURRENTLY signed in at
  /// the moment the rotation fires — never the user who was signed in when
  /// the stream was first subscribed, since that could be stale by the
  /// time a real rotation happens. Silently ignored for a guest session,
  /// same guard as [_registerDeviceIfPossible]. No epoch check needed here:
  /// [_profile] is read fresh at invocation and there is no `await` before
  /// the write below for a concurrent identity change to race against.
  Future<void> _onTokenRefresh(String token) async {
    final profile = _profile;
    if (profile == null || profile.isGuest) return;
    try {
      await _deviceRepository.registerDevice(userId: profile.id, token: token, platform: 'android', appVersion: appVersion);
    } catch (_) {
      // Best-effort - must never surface to the caller.
    }
  }

  /// Best-effort push-device cleanup (spec 2.3's sign-out requirement) -
  /// shared by an explicit [logout] and an external session loss detected
  /// in [_syncFromService]. Never throws - a cleanup failure must never
  /// block the auth flow itself; the caller still transitions to guest
  /// either way.
  ///
  /// FCM Final Cleanup - each step gets its OWN try/catch, deliberately:
  /// [DeviceRepository.deactivateDevice] (Supabase) and
  /// [PushNotificationService.unregisterDevice] (the FCM transport, revokes
  /// the token itself) are independent systems with independent failure
  /// modes. A single shared try/catch around both meant a `deactivateDevice`
  /// failure jumped straight past `unregisterDevice` entirely - a Supabase
  /// outage could leave a signed-out FCM token un-revoked. Neither
  /// operation's failure may prevent the other from being attempted, and
  /// `getToken()` itself is also independently guarded so that even a
  /// failure THERE still lets `unregisterDevice()` be attempted afterward
  /// (it takes no token argument - see [PushNotificationService]).
  Future<void> _cleanupDevice() async {
    String? token;
    try {
      token = await _pushService.getToken();
    } catch (_) {
      // Best-effort - unregisterDevice() below is still attempted regardless.
    }
    if (token != null) {
      try {
        await _deviceRepository.deactivateDevice(token);
      } catch (_) {
        // Best-effort - must not prevent unregisterDevice() below.
      }
    }
    try {
      // Revokes the token itself (a real FCM implementation deletes it
      // outright), not just the Supabase row above - the strongest
      // available guarantee that a signed-out token is never mistaken for
      // one still belonging to this user (spec 2.3's sign-out requirement).
      await _pushService.unregisterDevice();
    } catch (_) {
      // Best-effort.
    }
  }

  Future<void> logout() async {
    // Invalidate FIRST - a registration still in flight for the user who
    // is about to be signed out must abandon its write rather than racing
    // the cleanup below (FCM Final Correction Task Finding 1).
    _invalidateInFlightRegistration();
    await _cleanupDevice();
    await _service.logout();
    _profile = await _service.continueAsGuest();
    notifyListeners();
  }

  @override
  void dispose() {
    _authStateSubscription?.cancel();
    _tokenRefreshSubscription?.cancel();
    super.dispose();
  }
}
