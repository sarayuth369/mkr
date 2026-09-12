import 'package:flutter/widgets.dart';

/// Production path: swap [MockAdService] for a `google_mobile_ads`-backed
/// implementation behind this same interface. Test ad unit IDs are used
/// during development; production IDs must be configurable (not hardcoded).
/// Every call site must check entitlement first — premium users never see
/// ad calls at all.
abstract class AdService {
  Widget buildBanner(BuildContext context);

  Future<void> maybeShowInterstitial(BuildContext context, {required String trigger});
}
