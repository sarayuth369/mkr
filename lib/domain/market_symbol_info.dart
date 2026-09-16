import 'asset_class.dart';

/// Lightweight catalog metadata for one symbol — no quote/price data, and
/// (for the real-mode implementation) no provider credit cost to obtain.
///
/// 2026-09-16 post-phone Closed Testing correction task (root cause): lets a
/// caller (e.g. [MarketsController]) know the full symbol universe BEFORE
/// requesting any quotes, so quote fetching can be paced/controlled — a
/// small featured/visible subset first, more on demand — instead of every
/// screen load requesting the whole catalog's quotes at once. See
/// [MarketService.getCatalog]'s doc comment for the full rationale.
class MarketSymbolInfo {
  const MarketSymbolInfo({
    required this.symbol,
    required this.displayName,
    required this.assetClass,
    required this.featured,
    required this.sortOrder,
  });

  final String symbol;
  final String displayName;
  final AssetClass assetClass;

  /// Curated by the backend catalog (real mode) as a small, reliable,
  /// product-intent-preserving subset — see `handleMarketSymbols` in
  /// `backend/src/market/market-routes.ts`. `false` for every symbol in
  /// demo mode ([MockMarketService] has no such curation concept).
  final bool featured;

  final int sortOrder;
}
