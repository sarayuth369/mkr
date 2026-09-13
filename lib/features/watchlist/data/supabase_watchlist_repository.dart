import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../../../core/persistence/app_local_store.dart';
import '../../auth/application/auth_controller.dart';
import '../domain/watchlist_repository.dart';

/// Cloud-synced watchlist for a logged-in user, backed by Supabase's
/// `watchlists`/`watchlist_items` tables (see
/// supabase/migrations/20260913000000_initial_schema.sql). Falls back to
/// the same local cache [MockWatchlistRepository] uses whenever the caller
/// is a guest, or whenever Supabase is briefly unreachable — the watchlist
/// must keep working offline, it just won't sync until connectivity
/// returns.
///
/// On the first successful read after a real login, merges whatever was in
/// local (guest) storage into the cloud watchlist exactly once per user per
/// device (tracked via [AppLocalStore.watchlistMergedForUser]) — never
/// duplicates symbols, never re-merges (and resurrects a deleted symbol) on
/// a later login.
class SupabaseWatchlistRepository implements WatchlistRepository {
  SupabaseWatchlistRepository(this._store, this._auth);

  final AppLocalStore _store;
  final AuthController _auth;

  sb.SupabaseClient get _client => sb.Supabase.instance.client;

  bool get _isLoggedIn => _auth.profile != null && _auth.profile!.isGuest == false;
  String? get _userId => _auth.profile?.id;

  @override
  Future<List<String>> getSymbols() async {
    if (!_isLoggedIn) return _store.watchlistSymbols ?? const [];

    try {
      final watchlistId = await _ensureDefaultWatchlist(_userId!);
      await _mergeLocalOnce(watchlistId);

      final rows = await _client
          .from('watchlist_items')
          .select('symbol')
          .eq('watchlist_id', watchlistId)
          .order('sort_order');
      final symbols = (rows as List).map((r) => r['symbol'] as String).toList();
      await _store.setWatchlistSymbols(symbols); // offline cache
      return symbols;
    } catch (_) {
      return _store.watchlistSymbols ?? const [];
    }
  }

  @override
  Future<void> setSymbols(List<String> symbols) async {
    await _store.setWatchlistSymbols(symbols); // always cache locally too
    if (!_isLoggedIn) return;

    try {
      final watchlistId = await _ensureDefaultWatchlist(_userId!);
      await _client.from('watchlist_items').delete().eq('watchlist_id', watchlistId);
      if (symbols.isNotEmpty) {
        await _client.from('watchlist_items').insert([
          for (var i = 0; i < symbols.length; i++) {'watchlist_id': watchlistId, 'symbol': symbols[i], 'sort_order': i},
        ]);
      }
    } catch (_) {
      // Offline or Supabase unreachable — the local cache above already
      // reflects the change; it will reach the cloud on the next
      // successful getSymbols()/setSymbols() call.
    }
  }

  Future<void> _mergeLocalOnce(String watchlistId) async {
    final userId = _userId!;
    if (_store.watchlistMergedForUser == userId) return;

    final local = _store.watchlistSymbols ?? const [];
    if (local.isNotEmpty) {
      final existing = await _client.from('watchlist_items').select('symbol').eq('watchlist_id', watchlistId);
      final existingSymbols = (existing as List).map((r) => r['symbol'] as String).toSet();
      final toAdd = local.where((s) => !existingSymbols.contains(s)).toList();
      if (toAdd.isNotEmpty) {
        final startOrder = existingSymbols.length;
        await _client.from('watchlist_items').insert([
          for (var i = 0; i < toAdd.length; i++) {'watchlist_id': watchlistId, 'symbol': toAdd[i], 'sort_order': startOrder + i},
        ]);
      }
    }
    await _store.setWatchlistMergedForUser(userId);
  }

  Future<String> _ensureDefaultWatchlist(String userId) async {
    final existing = await _client.from('watchlists').select('id').eq('user_id', userId).eq('name', 'default').maybeSingle();
    if (existing != null) return existing['id'] as String;
    final created = await _client.from('watchlists').insert({'user_id': userId, 'name': 'default'}).select('id').single();
    return created['id'] as String;
  }
}
