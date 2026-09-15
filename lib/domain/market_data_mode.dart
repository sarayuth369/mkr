import '../core/network/api_state.dart';

/// Where the market data currently on screen actually came from. Every
/// screen showing quotes must reflect one of these — never imply real-time
/// data when none is connected.
///
/// [connecting] and [providerError] describe transient/failed states of a
/// real provider connection (used by [MarketProviderManager]); a demo
/// service like [MockMarketService] only ever reports [demo].
enum MarketDataMode { live, demo, stale, connecting, providerError, offline }

extension MarketDataModeDisplayX on MarketDataMode {
  /// The mode to actually SHOW next to a market list/quote, given the
  /// current fetch [state] — 2026-09-15 frontend hardening task: "The green
  /// LIVE indicator must be derived from the actual result state/freshness,
  /// not from connection establishment alone." [MarketProviderManager.mode]
  /// reflects CONNECTION health (a provider's own health check), which can
  /// legitimately stay `live` even while one particular fetch fails (a
  /// single transient blip is not treated as a real outage) — so a screen
  /// that renders the status chip independently of its [ApiState] must run
  /// it through this first, or it can show `LIVE` next to an error message.
  /// A genuinely empty result is left untouched: an honest "zero results"
  /// is not itself a lie paired with a live connection.
  MarketDataMode effectiveFor<T>(ApiState<T> state) {
    if (state is ApiError<T> && (this == MarketDataMode.live || this == MarketDataMode.stale)) {
      return MarketDataMode.providerError;
    }
    return this;
  }
}
