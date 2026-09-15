import '../../../domain/market_quote.dart';

/// 2026-09-15 frontend hardening task - the failure taxonomy a batch quote
/// fetch can land in. Deliberately mirrors the backend's own error
/// classification (PROVIDER_UNAVAILABLE/PROVIDER_TIMEOUT/PROVIDER_RATE_LIMIT
/// vs a network-level failure to even reach it) rather than inventing a
/// third vocabulary.
enum MarketFetchFailureKind { providerError, offline }

/// Thrown by [MarketDataProvider.getQuote]/[MarketProviderManager.getQuote]
/// for a genuine fetch fault (HTTP non-200, malformed response, a provider
/// error envelope, a timeout, or a connection failure) - never for "this
/// symbol genuinely has no data", which stays a plain `null` return. Every
/// caller already wraps `getQuote` in try/catch and converts this into
/// `ApiState.error(...)`, so this is the minimal change that stops a real
/// failure from being silently swallowed into "no data for this symbol".
class MarketFetchException implements Exception {
  const MarketFetchException(this.kind, this.message);

  final MarketFetchFailureKind kind;
  final String message;

  @override
  String toString() => message;
}

/// What actually happened when fetching a BATCH of quotes
/// ([MarketService.getAllQuotes]/[getQuotesByCategory]/[search]) - replaces
/// a bare `List<MarketQuote>` so a provider failure can never be silently
/// collapsed into an indistinguishable empty list (the exact
/// `LIVE / Updated just now` + `No markets available` contradiction this
/// task exists to close). See [MarketProviderManager.getQuotes],
/// [TwelveDataProvider.getQuotes], [MarketsController]/[HomeController] for
/// how this flows from the wire through to the UI.
sealed class MarketFetchResult {
  const MarketFetchResult();

  /// The quotes that DID resolve, regardless of outcome - empty for
  /// [MarketFetchEmpty]/[MarketFetchFailure].
  List<MarketQuote> get quotes => const [];
}

/// Every requested symbol resolved successfully.
final class MarketFetchSuccess extends MarketFetchResult {
  const MarketFetchSuccess(this.quotes);

  @override
  final List<MarketQuote> quotes; // non-empty by construction
}

/// Some symbols resolved, some failed - both are preserved. Successful
/// quotes must remain visible; failed symbols must be represented honestly
/// rather than hidden (task: "A successful response with valid data but an
/// unusable subset must not become a false provider-error for the whole
/// screen").
final class MarketFetchPartial extends MarketFetchResult {
  const MarketFetchPartial(this.quotes, this.failedSymbols);

  @override
  final List<MarketQuote> quotes; // non-empty by construction
  final List<String> failedSymbols; // non-empty by construction
}

/// A genuinely valid, zero-item result - no error occurred; there is simply
/// nothing to show (e.g. an empty category, a search with no matches, an
/// empty requested symbol set). This is NOT a stand-in for a failure - it
/// must only ever be produced when the fetch itself was honestly successful.
final class MarketFetchEmpty extends MarketFetchResult {
  const MarketFetchEmpty();
}

/// The provider/backend could not honestly satisfy this request at all -
/// HTTP non-200, malformed response, a provider error envelope, a timeout,
/// a connection failure, or every requested symbol failing. Must never be
/// silently converted into [MarketFetchEmpty] by any caller.
final class MarketFetchFailure extends MarketFetchResult {
  const MarketFetchFailure(this.kind, this.message);

  final MarketFetchFailureKind kind;
  final String message;
}
