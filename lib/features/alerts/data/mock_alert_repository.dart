import '../../../core/persistence/app_local_store.dart';
import '../domain/alert.dart';
import '../domain/alert_repository.dart';

class MockAlertRepository implements AlertRepository {
  MockAlertRepository(this._store);

  final AppLocalStore _store;

  @override
  Future<List<Alert>> getAlerts() async {
    final raw = _store.alertsJson;
    if (raw == null) return [];
    return raw.map(Alert.fromJson).toList();
  }

  @override
  Future<void> saveAlerts(List<Alert> alerts) {
    return _store.setAlertsJson(alerts.map((a) => a.toJson()).toList());
  }
}
