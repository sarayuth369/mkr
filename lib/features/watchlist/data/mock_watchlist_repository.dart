import '../../../core/persistence/app_local_store.dart';
import '../domain/watchlist_repository.dart';

class MockWatchlistRepository implements WatchlistRepository {
  MockWatchlistRepository(this._store);

  final AppLocalStore _store;

  static const List<String> defaultSymbols = [
    'XAU/USD',
    'BTC',
    'NVDA',
    'QQQ',
    'EUR/USD',
    'SET',
  ];

  @override
  Future<List<String>> getSymbols() async {
    return _store.watchlistSymbols ?? List.of(defaultSymbols);
  }

  @override
  Future<void> setSymbols(List<String> symbols) => _store.setWatchlistSymbols(symbols);
}
