PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Frontend Market Data Hardening — Correction 2
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FRONTEND_MARKET_DATA_HARDENING_CORRECTION_TASK_2.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FRONTEND_MARKET_DATA_HARDENING_CORRECTION_2_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Frontend Market Data Hardening - Correction, completed, was
WAITING_FOR_GPT_REVIEW (commit f135983). Mac reviewed and found four
remaining real-mode catalog bypasses/mock-data leaks that still needed
closing before another APK/Closed Testing.

THIS PASS - closed all four proven defects, nothing else:

Defect A - getQuote bypassed the catalog:
`ProviderBackedMarketService.getQuote(symbol)` forwarded straight to
`MarketProviderManager.getQuote()`, so `MarketDetailController` and
`GoldRadarController` could request a disabled/removed backend symbol.
Fixed by validating against the same `MarketCatalogRepository` first - a
disabled/unknown symbol now returns `null` (the method's own documented
"no data for this symbol" outcome), never reaching the provider. A
genuine catalog LOAD failure (network/backend down) throws
`MarketFetchException(offline, ...)`, same honest-failure discipline as
every batch path - never a silent fallback.

Defect B - getPriceSeries bypassed the catalog:
`getPriceSeries(symbol, timeframe)` called
`MarketProviderManager.getHistoricalCandles()` directly. Fixed with the
same catalog check; a disabled/unknown symbol or a catalog load failure
both now resolve as an empty series (the existing bare
`Future<List<double>>` shape was preserved, per the task's "preserve the
existing singular API shape" instruction) - the correct signal for the
UI to omit the chart rather than show something fabricated.

Defect C - watchQuotes bypassed the catalog:
`watchQuotes(symbols)` forwarded the caller's symbols straight to the
manager with no check, and `MarketDetailController` subscribed with its
raw `symbol` argument. Fixed inside `ProviderBackedMarketService`: the
catalog is loaded and the symbol list filtered to the enabled set
BEFORE the shared broadcast stream opens its upstream subscription
(inside the existing `onListen`) - the shared-stream architecture is
unchanged, no per-screen socket was added, and `MarketDetailController`
needed no changes since it already calls `watchQuotes([symbol])`
through this now-authorized path.

Defect D - MockMarketCatalog fabricated market data in real mode:
Removed every real-mode call site that used
`MockMarketCatalog.syntheticSeries`/`.bySymbol` to fake a chart or trend
direction:
- Home: the Gold card, the Pulse card carousel, and the Snapshot list
  all dropped their fabricated `syntheticSeries` sparkline (the
  `AssetRow`/`MarketCard` `sparkline` param is optional and already
  renders correctly with nothing passed). The Pulse detail chart's
  `isUp` direction used to read `MockMarketCatalog.bySymbol(...).changePct`
  - now tracks the real selected quote's own `changePct` instead
  (`_PulseSectionState._selectedChangePct`), since the real quote object
  was already in hand at selection time and was never being used for
  this.
- Markets and Watchlist: dropped the same fabricated `AssetRow`
  sparkline from their list rows.
- Gold Radar: `GoldRadarController` now fetches a genuine
  `getPriceSeries('XAU/USD', ChartTimeframe.d1)` alongside the quote;
  the screen renders the real series when available and omits the price
  chart entirely when it isn't (never synthetic) - satisfying the task's
  explicit "use genuine historical series when available, OR omit"
  instruction for the one screen where a single real per-symbol fetch is
  cheap enough to justify over omission.
`GoldRadarController`'s `getQuote('DXY')`/`getQuote('US10Y')`/`getQuote('OIL')`
calls needed NO changes - they already pass `null` straight through to
`GoldRadarData.derive`, which was already null-safe, and
`gold_radar_screen.dart`'s `_RelatedMarkets` already
`whereType<MarketQuote>()`-filters nulls. Once Defect A made `getQuote`
catalog-authorized, this existing code became correct automatically:
verified live against production that DXY is currently disabled
(`GET /api/mkr/market/quotes?symbols=DXY` -> `INVALID_SYMBOL`), so this
is a real, currently-exercised condition, not a hypothetical.

ADDITIONAL CONSISTENCY CHECK (not fixed this pass - flagged for a
future task, out of the acceptance gate's named screens):
`PortfolioController._recompute()` and `AlertsController._evaluate()`
both build their quote map from `MockMarketCatalog.all` regardless of
real/demo mode - Portfolio P&L and price-alert triggering are currently
computed from static mock prices even in real mode. This was found by
the task's required grep audit but is NOT one of the four named
defects, is NOT one of the five screens in the task's own acceptance
gate (Home/Markets/Watchlist/Gold Radar/Market Detail), and fixing it
properly needs a new dependency (`MarketService`) wired into both
controllers plus a polling-cadence decision for Alerts's 30s timer -
real architecture work, not a call-site swap, so it was left alone per
"no broad refactor" and reported here instead of silently fixed or
silently ignored. Two dropdown symbol pickers
(`portfolio_screen.dart`'s add-holding sheet, `create_alert_screen.dart`'s
symbol picker) also read `MockMarketCatalog.all`, but only for
symbol/name text, never price/trend - reviewed and left as-is, this is
a symbol-name registry, not market-data display. The `alpaca_provider.dart`/
`twelve_data_provider.dart` `_assetClassFor()` fallback also reads
`MockMarketCatalog.bySymbol(...).assetClass` - reviewed and left as-is,
this is an asset-class classification lookup, never a displayed
price/chart/trend value.

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 256/256 passing (13 new across
  `test/logic/provider_backed_market_service_test.dart` (extended - 9
  new tests covering getQuote/getPriceSeries/watchQuotes catalog
  authorization) and `test/logic/gold_radar_controller_test.dart`
  (new - 4 tests covering honest partial-unavailability and the real
  series/omission behavior)). `flutter analyze`: no issues.
  `flutter build apk --debug`: succeeds.
- Security scan (established grep pattern) against the diff: no
  secrets.
- git diff reviewed - scoped exactly to the defect files, their tests,
  and this CURRENT.md; no Market Pool, Firebase/FCM, Economic Calendar,
  News Radar, Supabase, or backend changes; `auc/backend` untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. The existing
  `GET /api/mkr/market/symbols`/`/quotes` endpoints already support
  every fix here.
- Live smoke check performed: `/api/mkr/health` OK, `/api/mkr/market/symbols`
  OK (XAU/USD present, featured), `/api/mkr/market/quotes?symbols=DXY,XAU/USD`
  confirms DXY is currently disabled in production
  (`INVALID_SYMBOL`) while XAU/USD returns real live data - directly
  validating Defect A's real-world impact on Gold Radar and that the
  fix handles it correctly (DXY: honestly omitted, never requested,
  never fabricated).

NEXT:
Claude has completed this correction and stopped, per its own
instruction. No further improvement loop started. The Portfolio/Alerts
MockMarketCatalog finding above is flagged for GPT/Mac to decide
whether it warrants its own follow-up task. Waiting for GPT/Mac review.
