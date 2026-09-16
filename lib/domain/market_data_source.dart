/// Which provider a [MarketQuote]/[MarketCandle] actually came from. Purely
/// informational (useful for debugging/telemetry) — the production UI shows
/// [MarketDataMode], not this, so it never has to explain "Twelve Data" vs
/// "Alpaca" to an end user.
///
/// [unavailable] is a genuine REAL-mode backend response whose `source`
/// value this client doesn't recognize (e.g. the backend's own honest
/// `'unavailable'` — see backend `MarketDataSource` in `types.ts`) — never
/// [demo], which is reserved for actual mock/simulated data. Collapsing an
/// unrecognized real-mode value into [demo] would conflate "a genuine
/// backend answer we can't label" with "synthetic data," exactly the kind
/// of silent attribution loss the hybrid-provider work risked introducing
/// (2026-09-16 Final Full-System One-Pass audit finding).
enum MarketDataSource { demo, twelveData, alpaca, unavailable }
