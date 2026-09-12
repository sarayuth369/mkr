/// Seam for watchlist persistence. [MockWatchlistRepository] backs this with
/// local storage in Phase 1; a future `SupabaseWatchlistRepository` can
/// implement the same interface to sync across devices without any UI or
/// controller changes.
abstract class WatchlistRepository {
  Future<List<String>> getSymbols();

  Future<void> setSymbols(List<String> symbols);
}
