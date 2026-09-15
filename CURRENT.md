PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Frontend Market Data Hardening — Final Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FRONTEND_MARKET_DATA_HARDENING_FINAL_CORRECTION_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FRONTEND_MARKET_DATA_HARDENING_FINAL_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Frontend Market Data Hardening - Correction 2, completed, was
WAITING_FOR_GPT_REVIEW (commit 4c8b4ba). Mac reviewed and found four more
remaining real-mode defects that still needed closing before another
APK/Closed Testing.

THIS PASS - closed all four remaining proven defects, nothing else:

1. watchCandles bypassed the catalog:
`ProviderBackedMarketService.watchCandles()` called
`MarketProviderManager.getHistoricalCandles()`/`watchCandles()` directly
with no catalog check - Market Detail's candlestick view used this path.
Fixed with the same authorization pattern already used by watchQuotes:
the check runs inside the stream's onListen before either the historical
fetch or the live subscription opens. Disabled/unknown symbol never
reaches the manager; catalog load failure means the stream honestly
never emits. Shared single-subscription architecture unchanged.

2. Real-mode Portfolio priced from MockMarketCatalog:
`PortfolioController._recompute()` built its quote map from
`MockMarketCatalog.all` unconditionally - displayed P&L/valuation could
be fabricated/stale in real mode. Fixed by fetching one batched
`MarketService.getQuotesFor(heldSymbols)` call instead (same
catalog-authorized path Watchlist already used). The existing
`PortfolioCalculations.summarize` already priced a missing quote at cost
basis (0 P&L) rather than fabricating one - wiring in real quotes made
that existing honest-degradation logic apply to real data. Only called
from load/add/remove, never from a widget build, so no request storm.

3. Real-mode Alerts evaluated from MockMarketCatalog:
`AlertsController._evaluate()`'s 30-second periodic evaluator built its
quote map from `MockMarketCatalog.all` unconditionally - price/
percentage alerts could trigger/suppress on invented prices. Fixed by
collecting the unique symbols the currently-enabled price/percentage
alerts need (deduplicated) and making ONE batched `getQuotesFor()` call
per cycle - never N individual calls, never a new provider/WebSocket per
alert. Event-only cycles never call the market service at all.
`getQuotesFor` never throws, so a market-service outage leaves the
quotes map empty; the existing (unchanged) AlertEvaluator price/
percentage checks already treat a missing quote as "does not fire" - the
alert list is left completely untouched that cycle, preserving the last
known state exactly, never a fabricated trigger. Failure is logged via
debugPrint (matching this codebase's existing convention). Cooldown/
dedupe semantics untouched.

4. getPriceSeries hid a catalog-load failure as a valid empty chart:
A backend catalog outage and a genuine "no history for this symbol"
outcome were both `[]` - indistinguishable to any caller. Fixed
(existing `Future<List<double>>` shape preserved): a disabled/unknown
symbol still returns `[]` (still genuinely "no history"); a catalog LOAD
failure now throws `MarketFetchException`, same pattern `getQuote`
already established. `MarketDetailController` gained a
`seriesUnavailable` getter distinguishing the two, surfaced in
`market_detail_screen.dart` as a distinct "chart data unavailable, tap
to retry" state (new `chartSeriesUnavailable` l10n string, en+th).
`loadSeries()` previously had NO try/catch at all - this task's change
would otherwise have introduced a latent bug (an unguarded throw
breaking `_load()` mid-sequence); now caught correctly. GoldRadarController's
series fetch is now in its own try/catch so a rare series-only failure
no longer discards already-successful gold/dxy/us10y/oil data.
home_screen.dart's `_PulseSectionState` (calls getPriceSeries directly,
not through a controller) also gained try/catch at both call sites -
previously unguarded, would have become an unhandled async error.

GLOBAL RE-AUDIT (MockMarketCatalog across lib/features):
Re-classified every remaining reference: demo-only implementations
(MockMarketAIService, MockMarketService, DemoMarketDataProvider - never
constructed in real mode); symbol-name-only pickers, never price/trend
(portfolio_screen.dart add-holding dropdown, create_alert_screen.dart
symbol dropdown); asset-class classification only, never price/trend/
provider-request (alpaca_provider.dart/twelve_data_provider.dart
_assetClassFor fallback); doc comments only (no code) in several files.
No remaining real-mode price/valuation/alert-trigger/chart/trend use of
MockMarketCatalog anywhere in lib/features. Home, Markets, Market
Detail, Watchlist, Gold Radar, Portfolio, and Alerts all confirmed to
route every real-mode market-data access through MarketCatalogRepository
-> MarketService -> typed result/state -> controller -> UI.

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 275/275 passing (19 new: 4 watchCandles catalog-authorization
  tests, 5 PortfolioController tests (new file), 7 AlertsController
  tests (new file), 3 MarketDetailController seriesUnavailable tests
  (new file)). One pre-existing test
  (provider_backed_candle_aggregation_test.dart) updated to supply a
  real catalog stub, since it previously constructed
  MarketCatalogRepository with an unreachable URL on the assumption
  watchCandles never consulted it - exactly the bug this pass fixes, so
  the test needed updating to match the corrected, intended contract,
  same precedent as Correction 2's provider_backed_market_service_test.dart
  update. No test weakened or deleted. `flutter analyze`: no issues.
  `flutter build apk --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped exactly to the defect files, their tests,
  DI wiring in app.dart, and the new l10n string (en+th, source +
  generated); no Market Pool, Firebase/FCM, Economic Calendar, News
  Radar, Supabase, or backend changes; auc/backend untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. Every fix is served
  entirely by the already-deployed GET /api/mkr/market/symbols/quotes
  endpoints.
- Live smoke check performed: /api/mkr/health OK;
  /api/mkr/market/quotes?symbols=AAPL,DXY,XAU/USD confirms AAPL/XAU/USD
  return real live data while DXY returns INVALID_SYMBOL - directly
  validating the exact batch endpoint (getQuotesFor) Portfolio and
  Alerts now use, against both a resolvable and a disabled symbol.

NEXT:
Claude has completed this correction and stopped, per its own
instruction. No further improvement loop started. Waiting for GPT/Mac
review.
