/// Pure ad-eligibility rules, kept independent of Flutter/Provider so they
/// can be unit-tested directly. Every ad surface (banner slots, app-open)
/// funnels through this instead of re-deriving "should ads show" logic in
/// each widget.
class AdsEligibility {
  const AdsEligibility._();

  /// `true` only when the ad system is on at all AND the viewer isn't a
  /// premium (ad-free) user. Individual slot/app-open flags are combined
  /// with this by the caller — this is the one shared gate every ad
  /// surface must pass first.
  static bool shouldShowAds({required bool adsEnabled, required bool isPremium}) => adsEnabled && !isPremium;
}
