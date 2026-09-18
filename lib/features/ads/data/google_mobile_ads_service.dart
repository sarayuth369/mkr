import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import '../domain/ad_analytics.dart';
import '../domain/ad_config.dart';
import '../domain/ad_service.dart';

/// Real `google_mobile_ads`-backed [AdService] — 2026-09-17 AdMob + Billing
/// task. Ad unit IDs and test/production selection come from [AdConfig]
/// (never hardcoded here). Every ad request is gated by
/// [UmpConsentService.requestConsentAndCheckIfAdsCanBeRequested] having
/// already reported `true` for this session — see [canRequestAds], which
/// `main.dart`'s startup sequence sets before this service is ever asked
/// to load anything (a failed/incomplete consent flow means no ad request
/// is ever made this session, matching the task's "request ads only when
/// canRequestAds() allows it" requirement exactly).
class GoogleMobileAdsService implements AdService {
  GoogleMobileAdsService({
    required this.config,
    required bool canRequestAds,
    AdAnalytics analytics = const NoopAdAnalytics(),
  })  : _canRequestAds = canRequestAds,
        _analytics = analytics;

  final AdConfig config;
  final AdAnalytics _analytics;
  final bool _canRequestAds;

  static const int _interstitialEveryNTriggers = 3;
  final Map<String, int> _triggerCounts = {};

  AppOpenAd? _appOpenAd;
  bool _loadingAppOpenAd = false;
  InterstitialAd? _interstitialAd;
  bool _loadingInterstitialAd = false;

  AdRequest get _adRequest => const AdRequest();

  @override
  Widget buildBanner(BuildContext context) {
    if (!_canRequestAds) return const SizedBox.shrink();
    return _RealBannerAd(adUnitId: config.androidBannerAdUnitId, analytics: _analytics);
  }

  @override
  Future<bool> loadAppOpenAd() async {
    if (!_canRequestAds || _loadingAppOpenAd || _appOpenAd != null) return _appOpenAd != null;
    _loadingAppOpenAd = true;
    try {
      final completer = Completer<bool>();
      await AppOpenAd.load(
        adUnitId: config.androidAppOpenAdUnitId,
        request: _adRequest,
        adLoadCallback: AppOpenAdLoadCallback(
          onAdLoaded: (ad) {
            _appOpenAd = ad;
            _analytics.onAdLoaded('appOpen');
            if (!completer.isCompleted) completer.complete(true);
          },
          onAdFailedToLoad: (error) {
            _analytics.onAdFailed('appOpen', error.message);
            if (!completer.isCompleted) completer.complete(false);
          },
        ),
      );
      return await completer.future;
    } catch (e) {
      _analytics.onAdFailed('appOpen', e.toString());
      return false;
    } finally {
      _loadingAppOpenAd = false;
    }
  }

  @override
  Future<void> showAppOpenAd(BuildContext context) async {
    final ad = _appOpenAd;
    if (ad == null) return;
    _appOpenAd = null; // an App Open ad can only ever be shown once - never reused
    ad.fullScreenContentCallback = FullScreenContentCallback<AppOpenAd>(
      onAdShowedFullScreenContent: (ad) => _analytics.onAdDisplayed('appOpen'),
      onAdDismissedFullScreenContent: (ad) => ad.dispose(),
      onAdFailedToShowFullScreenContent: (ad, error) {
        _analytics.onAdFailed('appOpen', error.message);
        ad.dispose();
      },
    );
    _analytics.onAppOpenShown();
    await ad.show();
  }

  @override
  Future<void> maybeShowInterstitial(BuildContext context, {required String trigger}) async {
    if (!_canRequestAds) return;
    final count = (_triggerCounts[trigger] ?? 0) + 1;
    _triggerCounts[trigger] = count;
    if (count % _interstitialEveryNTriggers != 0) return;

    if (_interstitialAd == null) await _loadInterstitial();
    final ad = _interstitialAd;
    if (ad == null) return;
    _interstitialAd = null;
    ad.fullScreenContentCallback = FullScreenContentCallback<InterstitialAd>(
      onAdShowedFullScreenContent: (ad) => _analytics.onAdDisplayed('interstitial'),
      onAdDismissedFullScreenContent: (ad) => ad.dispose(),
      onAdFailedToShowFullScreenContent: (ad, error) {
        _analytics.onAdFailed('interstitial', error.message);
        ad.dispose();
      },
    );
    await ad.show();
  }

  Future<void> _loadInterstitial() async {
    if (_loadingInterstitialAd) return;
    _loadingInterstitialAd = true;
    try {
      // No dedicated interstitial ad unit was provided by the operator
      // yet (only App Open + Banner) and this app has no interstitial
      // trigger wired up anywhere (matches the pre-existing zero-call-site
      // state confirmed by this task's own audit) - always uses AdConfig's
      // real test unit ID, never a fabricated production one. An operator
      // adding a real interstitial ad unit ID + a real trigger call site
      // is a separate, deliberate product decision, not part of this pass.
      final unitId = AdConfig.testInterstitialUnitId;
      final completer = Completer<void>();
      await InterstitialAd.load(
        adUnitId: unitId,
        request: _adRequest,
        adLoadCallback: InterstitialAdLoadCallback(
          onAdLoaded: (ad) {
            _interstitialAd = ad;
            _analytics.onAdLoaded('interstitial');
            if (!completer.isCompleted) completer.complete();
          },
          onAdFailedToLoad: (error) {
            _analytics.onAdFailed('interstitial', error.message);
            if (!completer.isCompleted) completer.complete();
          },
        ),
      );
      await completer.future;
    } catch (e) {
      _analytics.onAdFailed('interstitial', e.toString());
    } finally {
      _loadingInterstitialAd = false;
    }
  }

  @override
  void dispose() {
    _appOpenAd?.dispose();
    _appOpenAd = null;
    _interstitialAd?.dispose();
    _interstitialAd = null;
  }
}

/// Owns exactly one real [BannerAd]'s full async load/dispose lifecycle -
/// the interface's `buildBanner` must return synchronously, but a real
/// banner ad genuinely loads over the network, so that lifecycle has to
/// live inside a widget's own State rather than in the stateless
/// [GoogleMobileAdsService] itself (unlike [MockAdService]'s always-ready
/// placeholder Container). Created fresh per `buildBanner` call, matching
/// `MkrTopBannerAd`/`MkrBottomBannerAd`'s existing "call on every build"
/// pattern - Flutter's own `State` lifecycle (not rebuilt just because the
/// parent rebuilds, as long as the widget's position in the tree is
/// stable) keeps this from reloading the ad on every rebuild in practice.
class _RealBannerAd extends StatefulWidget {
  const _RealBannerAd({required this.adUnitId, required this.analytics});

  final String adUnitId;
  final AdAnalytics analytics;

  @override
  State<_RealBannerAd> createState() => _RealBannerAdState();
}

class _RealBannerAdState extends State<_RealBannerAd> {
  BannerAd? _ad;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final ad = BannerAd(
      adUnitId: widget.adUnitId,
      size: AdSize.banner,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (ad) {
          widget.analytics.onAdLoaded('banner');
          widget.analytics.onAdDisplayed('banner');
          if (mounted) setState(() => _ad = ad as BannerAd);
        },
        onAdFailedToLoad: (ad, error) {
          widget.analytics.onAdFailed('banner', error.message);
          ad.dispose();
          if (mounted) setState(() => _failed = true);
        },
        onAdClicked: (ad) => widget.analytics.onAdClicked('banner'),
      ),
    );
    await ad.load();
  }

  @override
  void dispose() {
    _ad?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ad = _ad;
    // Reserves the same 50dp height as the loading/placeholder state so
    // surrounding layouts (MkrTopBannerAd/MkrBottomBannerAd's fixed-height
    // slot) never jump once the real ad finishes loading.
    if (ad == null || _failed) return const SizedBox(width: double.infinity, height: 50);
    return SizedBox(width: ad.size.width.toDouble(), height: ad.size.height.toDouble(), child: AdWidget(ad: ad));
  }
}
