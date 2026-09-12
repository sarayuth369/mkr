import 'alert.dart';

abstract class AlertRepository {
  Future<List<Alert>> getAlerts();

  Future<void> saveAlerts(List<Alert> alerts);
}
