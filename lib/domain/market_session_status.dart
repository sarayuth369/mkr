/// Whether the underlying exchange/market itself is trading right now.
/// Deliberately separate from [MarketDataMode]: that enum is about the
/// health of *our* data pipe, this one is about the *market's* schedule.
/// Conflating the two is exactly how a quiet-because-closed market gets
/// mistaken for a dead connection and triggers a false provider failover.
enum MarketSessionStatus { open, closed, preMarket, afterHours, unknown }
