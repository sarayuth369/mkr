import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Thin typed wrapper around [SharedPreferences]. Every feature that needs
/// lightweight local persistence (theme, onboarding, watchlist, alerts,
/// portfolio, locale, currency) goes through this instead of touching
/// SharedPreferences directly.
class AppLocalStore {
  AppLocalStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<AppLocalStore> create() async {
    final prefs = await SharedPreferences.getInstance();
    return AppLocalStore(prefs);
  }

  static const _kThemeMode = 'theme_mode';
  static const _kLocale = 'locale';
  static const _kCurrency = 'currency';
  static const _kOnboardingComplete = 'onboarding_complete';
  static const _kWatchlistSymbols = 'watchlist_symbols';
  static const _kAlerts = 'alerts_json';
  static const _kPortfolioHoldings = 'portfolio_holdings_json';
  static const _kEntitlementTier = 'entitlement_tier';
  static const _kAuthSession = 'auth_session_json';
  static const _kWatchlistMergedForUser = 'watchlist_merged_for_user';
  static const _kAlertsMergedForUser = 'alerts_merged_for_user';

  String? get themeMode => _prefs.getString(_kThemeMode);
  Future<void> setThemeMode(String value) => _prefs.setString(_kThemeMode, value);

  String? get locale => _prefs.getString(_kLocale);
  Future<void> setLocale(String value) => _prefs.setString(_kLocale, value);

  String get currency => _prefs.getString(_kCurrency) ?? 'USD';
  Future<void> setCurrency(String value) => _prefs.setString(_kCurrency, value);

  bool get isOnboardingComplete => _prefs.getBool(_kOnboardingComplete) ?? false;
  Future<void> setOnboardingComplete(bool value) =>
      _prefs.setBool(_kOnboardingComplete, value);

  List<String>? get watchlistSymbols {
    final raw = _prefs.getString(_kWatchlistSymbols);
    if (raw == null) return null;
    return (jsonDecode(raw) as List).cast<String>();
  }

  Future<void> setWatchlistSymbols(List<String> symbols) =>
      _prefs.setString(_kWatchlistSymbols, jsonEncode(symbols));

  List<Map<String, dynamic>>? get alertsJson {
    final raw = _prefs.getString(_kAlerts);
    if (raw == null) return null;
    return (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
  }

  Future<void> setAlertsJson(List<Map<String, dynamic>> alerts) =>
      _prefs.setString(_kAlerts, jsonEncode(alerts));

  List<Map<String, dynamic>>? get portfolioHoldingsJson {
    final raw = _prefs.getString(_kPortfolioHoldings);
    if (raw == null) return null;
    return (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
  }

  Future<void> setPortfolioHoldingsJson(List<Map<String, dynamic>> holdings) =>
      _prefs.setString(_kPortfolioHoldings, jsonEncode(holdings));

  String? get entitlementTier => _prefs.getString(_kEntitlementTier);
  Future<void> setEntitlementTier(String value) =>
      _prefs.setString(_kEntitlementTier, value);

  Map<String, dynamic>? get authSessionJson {
    final raw = _prefs.getString(_kAuthSession);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> setAuthSessionJson(Map<String, dynamic>? session) {
    if (session == null) return _prefs.remove(_kAuthSession);
    return _prefs.setString(_kAuthSession, jsonEncode(session));
  }

  /// Tracks which user id has already had their local (guest) watchlist
  /// merged into their cloud watchlist on this device, so
  /// [SupabaseWatchlistRepository] only ever merges once per user per
  /// device rather than re-merging (and resurrecting deleted symbols) on
  /// every login.
  String? get watchlistMergedForUser => _prefs.getString(_kWatchlistMergedForUser);
  Future<void> setWatchlistMergedForUser(String userId) => _prefs.setString(_kWatchlistMergedForUser, userId);

  /// Same one-time-merge tracking as [watchlistMergedForUser], for
  /// [SupabaseAlertRepository]'s local-price-alerts-into-cloud merge.
  String? get alertsMergedForUser => _prefs.getString(_kAlertsMergedForUser);
  Future<void> setAlertsMergedForUser(String userId) => _prefs.setString(_kAlertsMergedForUser, userId);

  /// Wipes every locally-cached, per-account data set (watchlist, alerts,
  /// and the one-time-merge markers) — called on every logout so a
  /// different user (or a fresh guest) logging in next on this device can
  /// never see the previous account's cached data before a real fetch
  /// completes. Deliberately leaves device-level prefs alone (theme,
  /// locale, currency, onboarding, entitlement) — those aren't account data.
  Future<void> clearUserScopedCache() async {
    await _prefs.remove(_kWatchlistSymbols);
    await _prefs.remove(_kAlerts);
    await _prefs.remove(_kWatchlistMergedForUser);
    await _prefs.remove(_kAlertsMergedForUser);
  }
}
