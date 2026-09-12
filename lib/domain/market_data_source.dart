/// Which provider a [MarketQuote]/[MarketCandle] actually came from. Purely
/// informational (useful for debugging/telemetry) — the production UI shows
/// [MarketDataMode], not this, so it never has to explain "Twelve Data" vs
/// "Alpaca" to an end user.
enum MarketDataSource { demo, twelveData, alpaca }
