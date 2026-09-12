import 'market_data_config.dart';

/// The one place MKR symbols (from [MockMarketCatalog]) are translated to
/// provider-specific symbols. No other file should hard-code a
/// Twelve-Data/Alpaca symbol string — that scatter is exactly what makes a
/// provider swap expensive later.
///
/// Returns `null` when a provider genuinely doesn't cover a symbol (e.g.
/// Alpaca has no gold/forex/Thai-equity coverage) — callers must treat that
/// as "unavailable from this provider", never fall back to guessing a
/// symbol string.
class SymbolMapper {
  const SymbolMapper();

  static const Map<String, String> _twelveData = {
    // Gold
    'XAU/USD': 'XAU/USD',
    // US stocks / ETFs
    'NVDA': 'NVDA',
    'AAPL': 'AAPL',
    'MSFT': 'MSFT',
    'AMZN': 'AMZN',
    'META': 'META',
    'GOOGL': 'GOOGL',
    'TSLA': 'TSLA',
    'QQQ': 'QQQ',
    // Indices
    'SPX': 'SPX',
    'NDX': 'NDX',
    'DJI': 'DJI',
    'RUT': 'RUT',
    'VIX': 'VIX',
    // Crypto
    'BTC': 'BTC/USD',
    'ETH': 'ETH/USD',
    'SOL': 'SOL/USD',
    'XRP': 'XRP/USD',
    // Forex
    'EUR/USD': 'EUR/USD',
    'GBP/USD': 'GBP/USD',
    'USD/JPY': 'USD/JPY',
    'AUD/USD': 'AUD/USD',
    'USD/CAD': 'USD/CAD',
    // DXY, US10Y, OIL, SET, SET50 intentionally absent: not reliably
    // available on the Twelve Data Free tier / not a covered exchange —
    // return null (unavailable) rather than guess a symbol.
  };

  static const Map<String, String> _alpaca = {
    // US stocks / ETFs only — Alpaca has no gold/forex/indices/Thai coverage.
    'NVDA': 'NVDA',
    'AAPL': 'AAPL',
    'MSFT': 'MSFT',
    'AMZN': 'AMZN',
    'META': 'META',
    'GOOGL': 'GOOGL',
    'TSLA': 'TSLA',
    'QQQ': 'QQQ',
    // Crypto
    'BTC': 'BTC/USD',
    'ETH': 'ETH/USD',
    'SOL': 'SOL/USD',
    'XRP': 'XRP/USD',
  };

  String? toProviderSymbol(String mkrSymbol, MarketDataProviderId provider) {
    final table = switch (provider) {
      MarketDataProviderId.twelveData => _twelveData,
      MarketDataProviderId.alpaca => _alpaca,
    };
    return table[mkrSymbol];
  }

  bool supports(String mkrSymbol, MarketDataProviderId provider) => toProviderSymbol(mkrSymbol, provider) != null;
}
