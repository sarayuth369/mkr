import 'dart:async';

import 'package:flutter/widgets.dart';

import '../domain/ad_config.dart';
import '../domain/ad_service.dart';
import '../domain/app_open_ad_policy.dart';

/// Lifecycle-safe App Open ad manager: `load` / `showIfAvailable` /
/// `onAppForeground` / `canShow` / `dispose`, matching the conceptual API
/// requested. One instance lives for the app's lifetime (registered as a
/// single [Provider] in `app.dart`) — [AppOpenAdHost] is the only thing
/// that drives it, from a widget whose [BuildContext] is actually under
/// [Navigator] (required to show the ad dialog).
///
/// [isPremium] is passed in at each call rather than cached, so eligibility
/// always reflects the current entitlement state — this manager doesn't
/// own that concern (see [AdsEligibility]).
class AppOpenAdManager {
  AppOpenAdManager({
    required AdService adService,
    required AdConfig config,
    AppOpenAdPolicy? policy,
  })  : _adService = adService,
        _config = config,
        _policy = policy ?? const AppOpenAdPolicy();

  final AdService _adService;
  final AdConfig _config;
  final AppOpenAdPolicy _policy;

  bool _isLoaded = false;
  bool _isShowing = false;
  DateTime? _lastShownAt;

  bool get isShowing => _isShowing;

  /// Preloads an ad. Never blocks indefinitely — [AdService.loadAppOpenAd]
  /// resolves quickly and a failure just leaves [_isLoaded] `false`, so the
  /// app continues normally with no ad shown.
  Future<void> load({required bool isPremium}) async {
    if (!_config.appOpenEnabled || isPremium || _isLoaded) return;
    try {
      _isLoaded = await _adService.loadAppOpenAd();
    } catch (_) {
      _isLoaded = false;
    }
  }

  bool canShow({required bool isPremium, DateTime? now}) => _policy.canShow(
        appOpenEnabled: _config.appOpenEnabled,
        isPremium: isPremium,
        adLoaded: _isLoaded,
        isShowingAd: _isShowing,
        lastShownAt: _lastShownAt,
        now: now ?? DateTime.now(),
      );

  Future<void> showIfAvailable(BuildContext context, {required bool isPremium}) async {
    if (!canShow(isPremium: isPremium)) return;
    _isShowing = true;
    _isLoaded = false;
    try {
      await _adService.showAppOpenAd(context);
    } finally {
      _isShowing = false;
      _lastShownAt = DateTime.now();
      unawaited(load(isPremium: isPremium));
    }
  }

  /// Convenience for [AppOpenAdHost]: loads if nothing is preloaded yet,
  /// then shows if eligible. Safe to call on every cold start/foreground —
  /// the policy above enforces the actual frequency cap.
  Future<void> onAppForeground(BuildContext context, {required bool isPremium}) async {
    if (!_isLoaded) await load(isPremium: isPremium);
    if (!context.mounted) return;
    await showIfAvailable(context, isPremium: isPremium);
  }

  /// 2026-09-17 AdMob + Billing task: previously an empty no-op - the real
  /// [GoogleMobileAdsService] can hold a loaded native ad object that must
  /// be released, and nothing called this before (confirmed by this
  /// task's own audit: `Provider<AppOpenAdManager>` in `app.dart` never
  /// passed a `dispose:` callback). Now wired from both ends: this
  /// forwards to the real service's own [AdService.dispose], and
  /// `app.dart` actually calls this via the provider's `dispose:` callback.
  void dispose() => _adService.dispose();
}
