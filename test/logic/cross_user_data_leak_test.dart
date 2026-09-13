import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mkr/core/persistence/app_local_store.dart';
import 'package:mkr/features/alerts/data/mock_alert_repository.dart';
import 'package:mkr/features/alerts/domain/alert.dart';
import 'package:mkr/features/auth/data/mock_auth_service.dart';
import 'package:mkr/features/watchlist/data/mock_watchlist_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'logging out then logging in as a different user never leaks the previous '
    'user\'s locally-cached watchlist/alerts',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = await AppLocalStore.create();
      final auth = MockAuthService(store);
      final watchlistRepo = MockWatchlistRepository(store);
      final alertRepo = MockAlertRepository(store);

      // User A logs in and creates data.
      await auth.login(email: 'a@test.com', password: 'x');
      await watchlistRepo.setSymbols(['AAPL', 'TSLA']);
      await alertRepo.saveAlerts([Alert.price(id: 'a1', symbol: 'AAPL', target: 300, direction: PriceDirection.above)]);

      expect(await watchlistRepo.getSymbols(), ['AAPL', 'TSLA']);
      expect(await alertRepo.getAlerts(), hasLength(1));

      // A regression test for exactly this scenario: without clearing the
      // cache on logout, B would still see A's cached watchlist/alerts
      // (MockWatchlistRepository/MockAlertRepository store a single global
      // SharedPreferences key with no per-user scoping).
      await auth.logout();
      await auth.login(email: 'b@test.com', password: 'y');

      final symbolsForB = await watchlistRepo.getSymbols();
      final alertsForB = await alertRepo.getAlerts();

      expect(symbolsForB, isNot(contains('AAPL')));
      expect(symbolsForB, isNot(contains('TSLA')));
      expect(alertsForB, isEmpty);
    },
  );

  test('logging out returns to a clean guest state with no leftover account data', () async {
    SharedPreferences.setMockInitialValues({});
    final store = await AppLocalStore.create();
    final auth = MockAuthService(store);
    final watchlistRepo = MockWatchlistRepository(store);

    await auth.login(email: 'a@test.com', password: 'x');
    await watchlistRepo.setSymbols(['XAU/USD']);
    await auth.logout();

    expect(store.watchlistSymbols, isNull, reason: 'logout must clear the cached watchlist, not just the session');
  });
}
