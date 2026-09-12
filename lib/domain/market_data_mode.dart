/// Where the market data currently on screen actually came from. Every
/// screen showing quotes must reflect one of these — never imply real-time
/// data when none is connected.
///
/// [connecting] and [providerError] describe transient/failed states of a
/// real provider connection (used by [MarketProviderManager]); a demo
/// service like [MockMarketService] only ever reports [demo].
enum MarketDataMode { live, demo, stale, connecting, providerError, offline }
