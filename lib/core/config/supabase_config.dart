/// Non-secret Supabase connection config, read from `--dart-define` build
/// values — mirrors the same pattern as `MarketDataConfig`
/// (lib/features/markets/data/market_data_config.dart). `SUPABASE_ANON_KEY`
/// is a public, RLS-constrained key (safe to ship in a client, unlike the
/// service-role key, which never appears here or anywhere in Flutter).
///
/// [isConfigured] is `false` by default (both values empty) — every user-
/// data feature (auth, cloud watchlist sync, alerts, push) must check it
/// and fail gracefully rather than crash when Supabase hasn't been
/// provisioned yet. See docs/MKR-EXTERNAL-INTEGRATIONS.md.
class SupabaseConfig {
  const SupabaseConfig({required this.url, required this.anonKey});

  final String url;
  final String anonKey;

  bool get isConfigured => url.isNotEmpty && anonKey.isNotEmpty;

  static const _urlDefine = String.fromEnvironment('SUPABASE_URL', defaultValue: '');
  static const _anonKeyDefine = String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: '');

  static const SupabaseConfig instance = SupabaseConfig(url: _urlDefine, anonKey: _anonKeyDefine);
}
