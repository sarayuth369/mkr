import '../../../core/persistence/app_local_store.dart';
import '../domain/auth_service.dart';
import '../domain/user_profile.dart';

class MockAuthService implements AuthService {
  MockAuthService(this._store);

  final AppLocalStore _store;

  // Mock mode has no external event source — every state change here comes
  // from an explicit call below, so there's nothing to stream.
  @override
  Stream<void>? get authStateChanges => null;

  @override
  Future<UserProfile?> currentSession() async {
    final json = _store.authSessionJson;
    if (json == null) return null;
    return UserProfile.fromJson(json);
  }

  @override
  Future<UserProfile> login({required String email, required String password}) async {
    await Future.delayed(const Duration(milliseconds: 400));
    final profile = UserProfile(id: 'mock-${email.hashCode}', email: email);
    await _store.setAuthSessionJson(profile.toJson());
    return profile;
  }

  @override
  Future<UserProfile> register({required String email, required String password}) async {
    await Future.delayed(const Duration(milliseconds: 400));
    final profile = UserProfile(id: 'mock-${email.hashCode}', email: email);
    await _store.setAuthSessionJson(profile.toJson());
    return profile;
  }

  @override
  Future<UserProfile> continueAsGuest() async {
    const profile = UserProfile(id: 'guest', email: 'guest@mkr.app', isGuest: true);
    await _store.setAuthSessionJson(profile.toJson());
    return profile;
  }

  @override
  Future<void> logout() async {
    await _store.setAuthSessionJson(null);
    // Prevents the next user (or a fresh guest) on this device from seeing
    // this account's cached watchlist/alerts before a real fetch completes.
    await _store.clearUserScopedCache();
  }
}
