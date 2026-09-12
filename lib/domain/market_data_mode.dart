/// Where the market data currently on screen actually came from. Every
/// screen showing quotes must reflect one of these — never imply real-time
/// data when none is connected.
enum MarketDataMode { live, demo, stale, offline }
