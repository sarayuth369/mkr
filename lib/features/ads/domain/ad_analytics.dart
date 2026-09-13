/// Abstraction points for future ad analytics (ad loaded/failed/displayed/
/// clicked, app-open shown). No real analytics provider is wired up here —
/// [NoopAdAnalytics] is the only implementation until MKR has an analytics
/// system to report through.
abstract class AdAnalytics {
  void onAdLoaded(String slot);
  void onAdFailed(String slot, String reason);
  void onAdDisplayed(String slot);
  void onAdClicked(String slot);
  void onAppOpenShown();
}

class NoopAdAnalytics implements AdAnalytics {
  const NoopAdAnalytics();

  @override
  void onAdLoaded(String slot) {}

  @override
  void onAdFailed(String slot, String reason) {}

  @override
  void onAdDisplayed(String slot) {}

  @override
  void onAdClicked(String slot) {}

  @override
  void onAppOpenShown() {}
}
