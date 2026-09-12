import 'package:flutter/foundation.dart';

import '../domain/auth_service.dart';
import '../domain/user_profile.dart';

class AuthController extends ChangeNotifier {
  AuthController(this._service) {
    _restore();
  }

  final AuthService _service;

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
  }

  Future<void> register(String email, String password) async {
    _profile = await _service.register(email: email, password: password);
    notifyListeners();
  }

  Future<void> logout() async {
    await _service.logout();
    _profile = await _service.continueAsGuest();
    notifyListeners();
  }
}
