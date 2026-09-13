import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../../core/deeplink/auth_callback.dart';
import '../../../core/persistence/app_local_store.dart';
import '../domain/auth_service.dart';
import '../domain/email_confirmation_required_exception.dart';
import '../domain/user_profile.dart';

/// Real Supabase Auth-backed implementation of [AuthService]. Only ever
/// constructed when [SupabaseConfig.isConfigured] is true (see
/// `app.dart`) — `MockAuthService` remains the default otherwise, so the
/// app never depends on Supabase being configured to function.
///
/// "Guest" stays a purely client-side concept (per the Phase 2.4 spec's
/// "guest is client-side concept; do not create fake guest accounts") —
/// [continueAsGuest] never touches Supabase, it just records a local-only
/// profile in [AppLocalStore], identical to [MockAuthService]'s behavior.
class SupabaseAuthService implements AuthService {
  SupabaseAuthService(this._store);

  final AppLocalStore _store;

  sb.GoTrueClient get _auth => sb.Supabase.instance.client.auth;

  /// Reacts to auth events that can happen outside an explicit
  /// login()/register()/logout() call here — e.g. a refresh token being
  /// revoked/expiring server-side signs the user out without the app ever
  /// calling [logout]. [AuthController] subscribes to this and re-syncs
  /// [currentSession] whenever it fires.
  @override
  Stream<void> get authStateChanges => _auth.onAuthStateChange.map((_) {});

  UserProfile? _fromSupabaseUser(sb.User? user) {
    if (user == null) return null;
    return UserProfile(id: user.id, email: user.email ?? '');
  }

  @override
  Future<UserProfile?> currentSession() async {
    final supabaseUser = _fromSupabaseUser(_auth.currentUser);
    if (supabaseUser != null) return supabaseUser;

    final json = _store.authSessionJson;
    if (json == null) return null;
    final local = UserProfile.fromJson(json);
    // Only ever restore a locally-stored GUEST profile this way — a
    // non-guest profile with no live Supabase session is stale (e.g. the
    // access token expired) and must not be treated as still logged in.
    return local.isGuest ? local : null;
  }

  @override
  Future<UserProfile> login({required String email, required String password}) async {
    try {
      final response = await _auth.signInWithPassword(email: email, password: password);
      final profile = _fromSupabaseUser(response.user);
      if (profile == null) throw StateError('Supabase login did not return a user');
      await _store.setAuthSessionJson(null); // clear any local guest marker
      return profile;
    } on sb.AuthException catch (e) {
      // Re-thrown as a plain Exception so callers (e.g. LoginScreen) never
      // need to import supabase_flutter just to read a user-facing message.
      throw Exception(e.message);
    }
  }

  @override
  Future<UserProfile> register({required String email, required String password}) async {
    try {
      // Without emailRedirectTo, Supabase falls back to the project's Site
      // URL for the confirmation link — which is http://localhost:3000 on a
      // fresh project and is exactly what produced the otp_expired/
      // access_denied redirect this fixes. mkrAuthCallbackUrl must also be
      // added to Supabase Dashboard → Authentication → URL Configuration →
      // Redirect URLs, or Supabase rejects it and falls back the same way.
      final response = await _auth.signUp(email: email, password: password, emailRedirectTo: mkrAuthCallbackUrl);
      final profile = _fromSupabaseUser(response.user);
      if (profile == null) throw StateError('Supabase registration did not return a user');
      await _store.setAuthSessionJson(null);
      if (response.session == null) {
        // "Confirm email" is on for this project (Supabase's default) — the
        // account exists but there's no active session yet. Never claim the
        // caller is logged in when they're not.
        throw const EmailConfirmationRequiredException();
      }
      return profile;
    } on sb.AuthException catch (e) {
      throw Exception(e.message);
    }
  }

  @override
  Future<UserProfile> continueAsGuest() async {
    const profile = UserProfile(id: 'guest', email: 'guest@mkr.app', isGuest: true);
    await _store.setAuthSessionJson(profile.toJson());
    return profile;
  }

  @override
  Future<void> logout() async {
    if (_auth.currentUser != null) await _auth.signOut();
    await _store.setAuthSessionJson(null);
    // Prevents the next user (or a fresh guest) on this device from seeing
    // this account's cached watchlist/alerts before a real fetch completes.
    await _store.clearUserScopedCache();
  }
}
