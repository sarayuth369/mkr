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
}
