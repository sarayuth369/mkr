import 'alert.dart';

/// Mirrors server-evaluable alerts (currently price alerts only — see
/// [AlertType.price]) into cloud storage so the backend's Alert Engine can
/// keep evaluating them after the app closes (spec 2.3-C: "alert
/// evaluation must not depend solely on Flutter being open"). Percentage/
/// event/radar alerts stay local-only for now — they need context (radar
/// signals, event matching) the backend engine doesn't have yet.
///
/// [NoopAlertCloudSync] is the default (no Supabase configured, or the
/// current user is a guest) — the local `AlertRepository` remains fully
/// functional either way, this is a best-effort mirror, never a
/// requirement for alerts to work in-app.
abstract class AlertCloudSync {
  Future<void> syncPriceAlerts(List<Alert> alerts);
}

class NoopAlertCloudSync implements AlertCloudSync {
  const NoopAlertCloudSync();

  @override
  Future<void> syncPriceAlerts(List<Alert> alerts) async {}
}
