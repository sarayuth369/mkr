import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/app_info.dart';
import '../../push/data/noop_push_notification_service.dart';
import '../../push/domain/device_repository.dart';
import '../../push/domain/push_notification_service.dart';
import '../domain/auth_service.dart';
import '../domain/user_profile.dart';

/// Registers/deactivates the device's push token around login/logout (spec
/// 2.3-J). Both dependencies default to their Noop implementations, so this
/// is a genuine no-op end to end until a real [PushNotificationService] (one
/// that can actually mint an FCM token) replaces [NoopPushNotificationService]
/// - see docs/MKR-EXTERNAL-INTEGRATIONS.md. Never throws into the caller:
/// device registration is a best-effort enhancement, not a login requirement.
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

  Future<void> _restore() async {
    _profile = await _service.currentSession();
    _profile ??= await _service.continueAsGuest();
    _loading = false;
    notifyListeners();
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
        _profile = await _service.continueAsGuest();
        notifyListeners();
      }
      return;
    }
    if (updated != _profile) {
      _profile = updated;
      notifyListeners();
      unawaited(_registerDeviceIfPossible());
    }
  }

  Future<void> login(String email, String password) async {
    _profile = await _service.login(email: email, password: password);
    notifyListeners();
    unawaited(_registerDeviceIfPossible());
  }

  Future<void> register(String email, String password) async {
    _profile = await _service.register(email: email, password: password);
    notifyListeners();
    unawaited(_registerDeviceIfPossible());
  }

  Future<void> _registerDeviceIfPossible() async {
    final profile = _profile;
    if (profile == null || profile.isGuest) return;
    try {
      await _pushService.initialize();
      if (!await _pushService.requestPermission()) return;
      final token = await _pushService.getToken();
      if (token == null) return;
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
  /// same guard as [_registerDeviceIfPossible].
  Future<void> _onTokenRefresh(String token) async {
    final profile = _profile;
    if (profile == null || profile.isGuest) return;
    try {
      await _deviceRepository.registerDevice(userId: profile.id, token: token, platform: 'android', appVersion: appVersion);
    } catch (_) {
      // Best-effort - must never surface to the caller.
    }
  }

  Future<void> logout() async {
    try {
      final token = await _pushService.getToken();
      if (token != null) await _deviceRepository.deactivateDevice(token);
      // Revokes the token itself (a real FCM implementation deletes it
      // outright), not just the Supabase row above - the strongest
      // available guarantee that a signed-out token is never mistaken for
      // one still belonging to this user (spec 2.3's sign-out requirement).
      await _pushService.unregisterDevice();
    } catch (_) {
      // Best-effort - must never block logout.
    }
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
