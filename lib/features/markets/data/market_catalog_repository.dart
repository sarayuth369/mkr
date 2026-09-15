import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../domain/asset_class.dart';

/// One entry from the backend's public catalog (`GET /api/mkr/market/symbols`,
/// see `backend/src/market/market-routes.ts` `handleMarketSymbols`) - the
/// real-mode counterpart to [MockMarketCatalog]'s static list. Carries only
/// display metadata; provider-specific symbol mapping stays server-side.
class CatalogSymbol {
  const CatalogSymbol({
    required this.symbol,
    required this.displayName,
    required this.assetClass,
    required this.featured,
    required this.sortOrder,
  });

  final String symbol;
  final String displayName;
  final AssetClass assetClass;
  final bool featured;
  final int sortOrder;
}

/// Thrown when the backend catalog cannot be honestly loaded — 2026-09-15
/// hardening task: "If the backend catalog cannot be fetched, fail
/// honestly; do not silently fall back to the mock catalog in real mode."
class MarketCatalogException implements Exception {
  const MarketCatalogException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Backend `category` string -> Flutter [AssetClass] - the ONE place this
/// mapping happens, so no widget/controller ever hard-codes it. An
/// unrecognized category (e.g. a future backend category this build
/// predates) is rejected rather than guessed - see [MarketCatalogRepository._parse].
AssetClass? assetClassFromCategory(String? category) => switch (category) {
      'gold' => AssetClass.gold,
      'us_stock' => AssetClass.usStock,
      'indices' => AssetClass.indices,
      'crypto' => AssetClass.crypto,
      'forex' => AssetClass.forex,
      'thailand' => AssetClass.thailand,
      'commodity' => AssetClass.commodity,
      'rate' => AssetClass.rate,
      _ => null,
    };

/// Typed, real-mode symbol catalog — 2026-09-15 frontend hardening task.
/// This is the "backend market catalog → Flutter catalog/symbol registry"
/// step the mandated architecture requires: production Flutter must request
/// only symbols the backend currently has enabled, in ONE canonical MKR
/// format, never [MockMarketCatalog] (which stays demo-mode-only).
///
/// Normalizes/dedupes entries and silently rejects anything malformed
/// (missing/blank symbol, unrecognized category) rather than guessing — an
/// unusable entry is simply excluded, never fabricated into something
/// usable.
///
/// Cached briefly (the catalog changes rarely) with client-side
/// single-flight: concurrent callers during app startup (Home, Markets,
/// Watchlist can all construct their controllers around the same moment)
/// share the same in-flight request instead of each issuing their own.
class MarketCatalogRepository {
  MarketCatalogRepository({required this.backendBaseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String backendBaseUrl;
  final http.Client _http;

  static const _cacheTtl = Duration(minutes: 5);

  List<CatalogSymbol>? _cache;
  DateTime? _cachedAt;
  Future<List<CatalogSymbol>>? _inFlight;

  Uri get _uri => Uri.parse('$backendBaseUrl/api/mkr/market/symbols');

  /// A synchronous peek at whatever catalog was last successfully loaded —
  /// `null` only if nothing has ever loaded successfully yet. Deliberately
  /// ignores [load]'s 5-minute price-freshness TTL (a symbol's asset class
  /// essentially never changes, unlike its price) and never triggers a
  /// fetch itself. 2026-09-15 post-audit task (Finding 4): lets a provider
  /// classify a symbol's [AssetClass] from the real backend catalog without
  /// an async round-trip inside otherwise-synchronous parsing code — by the
  /// time a provider is asked to parse a quote/candle, the catalog-
  /// authorization check one layer up (see [ProviderBackedMarketService])
  /// has almost always already awaited [load], so this is warm in practice.
  List<CatalogSymbol>? get cachedSymbols => _cache;

  /// Loads the enabled backend catalog, using the cache when fresh.
  /// Throws [MarketCatalogException] on any failure — callers must NOT
  /// catch this and silently substitute [MockMarketCatalog]; the correct
  /// response is an honest offline/error state (see
  /// [ProviderBackedMarketService]).
  Future<List<CatalogSymbol>> load({bool forceRefresh = false}) {
    final cache = _cache;
    final cachedAt = _cachedAt;
    if (!forceRefresh && cache != null && cachedAt != null && DateTime.now().difference(cachedAt) < _cacheTtl) {
      return Future.value(cache);
    }

    final inFlight = _inFlight;
    if (inFlight != null) return inFlight;

    // NOT `future.whenComplete(...)` with the chained future discarded - an
    // error future with no listener on ITS OWN chained continuation is
    // "unhandled" in Dart's async machinery even though `future` itself
    // (returned below) IS properly awaited/caught by every caller; wrapping
    // in a single async function keeps exactly one future in play.
    final future = _fetchAndClearInFlight();
    _inFlight = future;
    return future;
  }

  Future<List<CatalogSymbol>> _fetchAndClearInFlight() async {
    try {
      return await _fetch();
    } finally {
      _inFlight = null;
    }
  }

  Future<List<CatalogSymbol>> _fetch() async {
    final http.Response response;
    try {
      response = await _http.get(_uri);
    } catch (_) {
      throw const MarketCatalogException('Could not reach the market catalog service.');
    }
    if (response.statusCode != 200) {
      throw MarketCatalogException('Could not load the market catalog (HTTP ${response.statusCode}).');
    }
    final dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw const MarketCatalogException('Received a malformed market catalog response.');
    }
    if (decoded is! Map<String, dynamic> || decoded['success'] != true) {
      throw const MarketCatalogException('The market catalog is currently unavailable.');
    }
    final data = decoded['data'];
    if (data is! List) throw const MarketCatalogException('Received a malformed market catalog response.');

    final symbols = _parse(data);
    _cache = symbols;
    _cachedAt = DateTime.now();
    return symbols;
  }

  List<CatalogSymbol> _parse(List<dynamic> raw) {
    final seen = <String>{};
    final symbols = <CatalogSymbol>[];
    for (final entry in raw) {
      if (entry is! Map) continue;
      final map = entry.cast<String, dynamic>();
      final symbol = (map['symbol'] as Object?)?.toString().trim();
      final assetClass = assetClassFromCategory((map['category'] as Object?)?.toString());
      if (symbol == null || symbol.isEmpty || assetClass == null) continue; // reject unsupported/malformed safely
      if (!seen.add(symbol)) continue; // dedupe - a repeated symbol keeps only the first occurrence

      symbols.add(CatalogSymbol(
        symbol: symbol,
        displayName: (map['displayName'] as Object?)?.toString() ?? symbol,
        assetClass: assetClass,
        featured: map['featured'] == true,
        sortOrder: (map['sortOrder'] as num?)?.toInt() ?? 0,
      ));
    }
    symbols.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return symbols;
  }
}
