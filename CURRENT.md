PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Frontend Market Data Hardening — Final Final Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FRONTEND_MARKET_DATA_HARDENING_FINAL_FINAL_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FRONTEND_MARKET_DATA_HARDENING_FINAL_FINAL_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Frontend Market Data Hardening - Final Correction, completed, was
WAITING_FOR_GPT_REVIEW (commit db09c43). Mac reviewed and found three more
remaining correctness/stability gaps that still needed closing before
another APK/Closed Testing.

THIS PASS - closed all three remaining defects, nothing else:

Defect 1 - Portfolio hid market-data failure behind a successful valuation:
PortfolioController._recompute() always built ApiState.success from
whatever getQuotesFor() returned - a provider-wide MarketFetchFailure
produced an empty quote map, which prices every holding at cost basis
(honest for one missing symbol, but the screen looked like a normal
successful valuation even when the whole fetch failed). Fixed with the
smallest coherent state mapping: MarketFetchFailure -> ApiState.error
(never success); MarketFetchSuccess -> success, not flagged (fully
live); MarketFetchPartial and MarketFetchEmpty (non-empty holdings) ->
success with isPartial: true, reusing the exact same mechanism
Markets/Watchlist already use for a degraded/partial indicator.
portfolio_screen.dart gained a small partial-data banner (mirroring
markets_screen.dart's existing one) shown when isPartial is true.

Defect 2 - Alerts periodic evaluation could overlap:
AlertsController's Timer.periodic(30s) called async _evaluate() with no
in-flight guard - a cycle slower than 30s could overlap the next tick,
firing two concurrent market fetches/evaluations and risking duplicate
notifications/persistence races. Fixed with a minimal `bool _evaluating`
guard wrapping the whole _evaluate() body in try/finally - an
overlapping call returns immediately without touching quotes/
evaluation/persistence; the next tick evaluates fresh state instead.
evaluateNow() (the test seam) calls _evaluate() directly so it
automatically respects the same guard. 30s cadence and all alert
semantics (cooldown, dedupe, event/radar logic) unchanged.

Defect 3 - Historical-fetch failure was still collapsed into []:
Unlike getQuote/getQuotes (already typed/exception-based from earlier
passes), getHistoricalCandles had NO failure channel anywhere in the
stack - TwelveDataProvider/AlpacaProvider swallowed every real fault
(HTTP non-200, malformed body, connection failure) into `const []`;
MarketProviderManager treated "no provider connected at all" the same
as "provider returned nothing"; ProviderBackedMarketService.watchCandles
called the manager unguarded, which would have become an unhandled
async error once the manager started throwing. Confirmed live: GET
/api/mkr/market/candles?symbol=DXY&interval=d1 returns a real HTTP 400
error envelope - a currently-reachable failure shape, not a
hypothetical. Fixed by matching getQuote's exact, already-established
contract at every layer: providers throw MarketFetchException for a
real fault, empty stays reserved for genuine "no history"; the manager
propagates a real fault (or throws when no provider is connected at
all) instead of returning []; watchCandles now catches the manager's
throw and calls controller.addError() so the candlestick stream's
listeners see a genuine error instead of an unhandled exception;
market_detail_screen.dart's candlestick StreamBuilder now checks
snapshot.hasError and shows the same "chart unavailable, retry" state
the line chart already uses. getPriceSeries needed no further change -
it already had no try/catch around the manager call (from the prior
pass), so the new throw propagates naturally, and every caller
(MarketDetailController, GoldRadarController, home_screen.dart) already
handles a thrown exception correctly from last pass's work.

GLOBAL RE-AUDIT:
Re-ran every acceptance-gate check (MockMarketCatalog price/chart/
trend/P&L/alert decisions; direct provider/manager access from UI/
controllers; catalog bypasses for quote/history/live/candle;
LIVE/STALE shown beside error/empty data; real failures collapsed into
[]/null where the caller can't distinguish). No new findings - Portfolio
and Alerts render no status chip at all (checked this pass, so no
LIVE-beside-error contradiction was ever possible there); everything
else confirmed unchanged from the prior pass's clean state.

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 287/287 passing (12 new across
  test/logic/alerts_controller_test.dart (in-flight guard, 2 tests),
  test/logic/market_provider_manager_test.dart (candle failure
  semantics, 5 tests), test/logic/provider_backed_market_service_test.dart
  (candle/series failure surfacing, 3 tests), and
  test/logic/portfolio_controller_test.dart (MarketFetchEmpty/Partial
  state mapping, 2 tests)). One pre-existing portfolio_controller_test.dart
  test asserting the OLD (buggy) failure-as-success behavior was updated
  to assert the corrected contract - the old assertion WAS the bug
  Defect 1 fixes, so this is a required correction, not a weakening; no
  other test was weakened or deleted. `flutter analyze`: no issues.
  `flutter build apk --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped exactly to the three defects' files, their
  tests, and the new l10n string (en+th, source + generated); no Market
  Pool, Firebase/FCM, Economic Calendar, News Radar, Supabase, or
  backend changes; auc/backend untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. Every fix is
  frontend-only.
- Live smoke check performed: /api/mkr/health OK;
  /api/mkr/market/quotes?symbols=AAPL,DXY re-confirms AAPL live/DXY
  disabled (unchanged); /api/mkr/market/candles?symbol=AAPL&interval=d1
  returns real OHLC data (200); /api/mkr/market/candles?symbol=DXY&interval=d1
  returns a real HTTP 400 error envelope, directly validating Defect 3's
  provider-level throw-on-non-200 fix against an actual production
  failure response (this symbol is filtered by the catalog before
  reaching this call in normal app usage, but the backend's real
  failure shape is now verified rather than assumed).

NEXT:
Claude has completed this correction and stopped, per its own
instruction. No further improvement loop started. Waiting for GPT/Mac
review.
