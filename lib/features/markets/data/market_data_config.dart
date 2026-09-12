/// Top-level demo/real switch — deliberately its own tiny enum rather than
/// reusing the UI-facing `MarketDataMode` (live/demo/stale/...) from
/// `lib/domain/market_data_mode.dart`, since this is a build-time
/// selection, not a runtime connection state.
enum MarketDataRunMode { demo, real }

enum MarketDataProviderId { twelveData, alpaca }

/// Non-secret configuration for which market-data path the app uses,
/// read from `--dart-define` build-time values. Never holds an API key —
/// keys live only on the backend proxy, never in this app.
///
/// Defaults to demo mode: flipping [mode] to [MarketDataRunMode.real] today
/// would leave every screen offline/provider-error since [backendBaseUrl]
/// doesn't resolve to a live MKR proxy yet (see the architecture plan's
/// "Explicitly deferred" section). Switching the default is a one-line
/// change once the backend team adds those routes.
class MarketDataConfig {
  const MarketDataConfig({
    required this.mode,
    required this.primaryProvider,
    required this.secondaryProvider,
    required this.backendBaseUrl,
    required this.secondaryEnabled,
  });

  final MarketDataRunMode mode;
  final MarketDataProviderId primaryProvider;
  final MarketDataProviderId? secondaryProvider;
  final String backendBaseUrl;

  /// Whether the secondary/standby provider is actually allowed to serve
  /// data, not just configured — kept `false` by default per the spec's
  /// "do not expose Alpaca data unless licensing is confirmed" rule.
  final bool secondaryEnabled;

  static const _modeDefine = String.fromEnvironment('MARKET_DATA_MODE', defaultValue: 'demo');
  static const _primaryDefine = String.fromEnvironment('MARKET_PRIMARY_PROVIDER', defaultValue: 'twelvedata');
  static const _secondaryDefine = String.fromEnvironment('MARKET_SECONDARY_PROVIDER', defaultValue: 'alpaca');
  static const _backendUrlDefine = String.fromEnvironment('MARKET_BACKEND_BASE_URL', defaultValue: '');
  static const _secondaryEnabledDefine = bool.fromEnvironment('MARKET_SECONDARY_ENABLED', defaultValue: false);

  static MarketDataConfig fromEnvironment() => parse(
        modeValue: _modeDefine,
        primaryValue: _primaryDefine,
        secondaryValue: _secondaryDefine,
        backendBaseUrl: _backendUrlDefine,
        secondaryEnabled: _secondaryEnabledDefine,
      );

  /// Pure parsing extracted for testing — [fromEnvironment] just supplies
  /// the actual `--dart-define` values to this.
  static MarketDataConfig parse({
    required String modeValue,
    required String primaryValue,
    required String secondaryValue,
    required String backendBaseUrl,
    required bool secondaryEnabled,
  }) {
    return MarketDataConfig(
      mode: modeValue.trim().toLowerCase() == 'real' ? MarketDataRunMode.real : MarketDataRunMode.demo,
      primaryProvider: _parseProvider(primaryValue) ?? MarketDataProviderId.twelveData,
      secondaryProvider: _parseProvider(secondaryValue),
      backendBaseUrl: backendBaseUrl.trim(),
      secondaryEnabled: secondaryEnabled,
    );
  }

  static MarketDataProviderId? _parseProvider(String value) {
    switch (value.trim().toLowerCase()) {
      case 'twelvedata':
      case 'twelve_data':
        return MarketDataProviderId.twelveData;
      case 'alpaca':
        return MarketDataProviderId.alpaca;
      default:
        return null;
    }
  }
}
