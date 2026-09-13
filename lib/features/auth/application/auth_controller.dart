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
  }

  final AuthService _service;
  final PushNotificationService _pushService;
  final DeviceRepository _deviceRepository;

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

  Future<void> logout() async {
    try {
      final token = await _pushService.getToken();
      if (token != null) await _deviceRepository.deactivateDevice(token);
    } catch (_) {
      // Best-effort - must never block logout.
    }
    await _service.logout();
    _profile = await _service.continueAsGuest();
    notifyListeners();
  }
}
