import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mkr/core/persistence/app_local_store.dart';
import 'package:mkr/features/watchlist/data/mock_watchlist_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('returns the default seed list when nothing is persisted yet', () async {
    SharedPreferences.setMockInitialValues({});
    final store = await AppLocalStore.create();
    final repo = MockWatchlistRepository(store);

    final symbols = await repo.getSymbols();
    expect(symbols, MockWatchlistRepository.defaultSymbols);
  });

  test('persists and returns an updated symbol list', () async {
    SharedPreferences.setMockInitialValues({});
    final store = await AppLocalStore.create();
    final repo = MockWatchlistRepository(store);

    await repo.setSymbols(['BTC', 'ETH']);
    final symbols = await repo.getSymbols();
    expect(symbols, ['BTC', 'ETH']);
  });
}
