import 'user_profile.dart';

/// Production path: Flutter → Cloudflare Worker → Supabase Auth. Phase 1
/// keeps everything in-memory/local via [MockAuthService] — the app works
/// fully in a guest mock-session by default so no flow is blocked on auth.
abstract class AuthService {
  Future<UserProfile?> currentSession();

  Future<UserProfile> login({required String email, required String password});

  Future<UserProfile> register({required String email, required String password});

  Future<UserProfile> continueAsGuest();

  Future<void> logout();

  /// Fires on auth events that happen outside an explicit call above (e.g.
  /// a Supabase refresh token expiring/being revoked server-side signs the
  /// user out without the app ever calling [logout]). `null` when an
  /// implementation has no such external event source (e.g.
  /// [MockAuthService], which only ever changes state via the calls above).
  Stream<void>? get authStateChanges => null;
}
