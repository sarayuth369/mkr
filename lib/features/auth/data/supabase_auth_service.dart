import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../../core/persistence/app_local_store.dart';
import '../domain/auth_service.dart';
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
    final response = await _auth.signInWithPassword(email: email, password: password);
    final profile = _fromSupabaseUser(response.user);
    if (profile == null) throw StateError('Supabase login did not return a user');
    await _store.setAuthSessionJson(null); // clear any local guest marker
    return profile;
  }

  @override
  Future<UserProfile> register({required String email, required String password}) async {
    final response = await _auth.signUp(email: email, password: password);
    final profile = _fromSupabaseUser(response.user);
    if (profile == null) throw StateError('Supabase registration did not return a user');
    await _store.setAuthSessionJson(null);
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
    if (_auth.currentUser != null) await _auth.signOut();
    await _store.setAuthSessionJson(null);
  }
}
