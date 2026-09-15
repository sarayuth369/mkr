PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Pre-Closed-Testing Full Stability Audit
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_PRE_CLOSED_TESTING_FULL_STABILITY_AUDIT_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_PRE_CLOSED_TESTING_FULL_STABILITY_AUDIT_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Candle Numeric Validation Correction, completed, was
WAITING_FOR_GPT_REVIEW (commit b064a8d). Mac then asked for one
comprehensive, single-pass audit of the entire real-mode market-data path
instead of another serial small-bug patch, covering 11 audit areas plus 4
explicitly named Known Issues (A-D).

WORKING-TREE NOTE: the task's premise listed 6 files as "currently
uncommitted... do not discard" - those were already reviewed, tested, and
committed as b064a8d in the immediately preceding turn before this audit
started (the task's snapshot predates that commit landing). Nothing was
discarded; this audit's commit builds on top of b064a8d.

THIS PASS - found and fixed 4 concrete defects (the 4 named Known Issues)
plus 1 additional defect of the same class found during the audit:

Known Issue A - watchQuotes()/watchCandles() silently hung on catalog
failure: onListen's catch block just `return`'d with no event at all -
confirmed a listener (e.g. MarketDetailController, which also had no
onError - see B) would wait forever with zero signal. Fixed: both now
call controller.addError(MarketFetchException(...)) before returning.

Known Issue B - MarketDetailController._watchLiveQuote() had no onError:
a live-stream fault (including the one A now correctly emits) became an
unhandled zone error, leaving the quote state frozen looking "live"
forever with no signal. Fixed: onError now sets ApiState.error, reusing
this screen's existing error+retry UI.

Known Issue C - MarketDetailController.loadSeries() late-response race:
rapidly switching timeframe before the first fetch resolves let a
slower, stale response silently overwrite a faster, newer one -
_timeframe would read correctly while _series held wrong data, an
inconsistent state invisible to the UI. Fixed with a _seriesRequestId
guard - a result only applies if no newer loadSeries call has started
since. SAME-CLASS BUG FOUND DURING AUDIT (not separately named): 
home_screen.dart's _PulseSectionState._selectSymbol/_changeTimeframe had
the identical shape and race - fixed with the identical guard pattern.

Known Issue D - MarketProviderManager.getHistoricalCandles() spurious
providerError risk: a genuinely empty history (provider returned
normally, no exception) still unconditionally called _handleFailure,
which performs a real confirmatory health check - pure waste in the
healthy case (result was already []), and if THAT unrelated health
check happened to blip, it would spuriously flip the WHOLE manager to
providerError over a symbol that was never actually a failure. Fixed:
skip _handleFailure entirely when the empty result is confirmed genuine
(no primaryError) - only call it when there's an actual fault to
investigate. Traced: happy-path behavior is provably unchanged.

ADDITIONAL FINDING (hygiene, not user-visible) - HomeController._watchLiveQuotes()
also had no onError. Unlike MarketDetailController (one quote), Home
shows a grid of already-loaded cards - wiping all of it on a live-ticker
hiccup would be worse than leaving good data visible, so fixed with a
lightweight debugPrint-only onError (matches AlertsController's existing
logging convention) instead of ApiState.error - prevents the unhandled
zone exception without discarding good data.

AUDIT AREAS RE-CHECKED, FOUND ALREADY CLEAN (no fix needed): mock/demo
contamination (MockMarketCatalog re-grep unchanged from prior pass),
catalog authority/bypass (all paths already authorized), candle cache
(failure-never-cached already correct), live tick merge (no corrupting
computation), MarketsController (synchronous client-side filters, no
async race possible), every .listen( call site in lib/features
enumerated (only Home/MarketDetail consume watchQuotes/watchCandles
directly, both fixed; market_detail_screen.dart's candlestick
StreamBuilder already error-aware from a prior pass).

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 318/318 passing (9 new/updated: 2 pre-existing
  provider_backed_market_service_test.dart tests corrected to assert the
  FIXED contract (stream error, not silence) rather than the bug itself;
  2 new market_detail_controller_test.dart tests (Issues B, C); 2 new
  market_provider_manager_test.dart tests (Issue D); 1 new
  home_controller_test.dart test (the additional finding)). No test was
  weakened or deleted. `flutter analyze`: no issues. `flutter build apk
  --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped to exactly 5 production files and 4 test
  files (300 insertions, 59 deletions total); no Market Pool, Firebase/
  FCM, Economic Calendar, News Radar, Supabase, or backend changes;
  auc/backend untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. This audit is
  entirely frontend-only.
- Live smoke check performed: /api/mkr/health OK; /api/mkr/market/symbols
  OK; /api/mkr/market/quotes?symbols=AAPL,XAU/USD OK real data;
  /api/mkr/market/candles?symbol=AAPL&interval=d1 OK real OHLC data.

REMAINING LIMITATIONS (real, not hand-waved):
1. No dedicated test for the home_screen.dart race fix - same algorithm
   as the fully-tested MarketDetailController fix, but the underlying
   widget is a line chart (not inspectable text), so coverage here is by
   code inspection + the full-app widget_test.dart smoke suite passing,
   not a dedicated unit/widget test.
2. getQuote/getQuotes share Issue D's exact structural pattern (an
   unconditional confirmatory health check on any empty/failed result) -
   the same fix would apply there too, but was intentionally left out of
   scope (task named getHistoricalCandles specifically; touching two more
   methods would exceed "minimal local fixes"). Flagged for a possible
   future task.
3. The internal _manager.watchQuotes/watchCandles subscriptions inside
   ProviderBackedMarketService still have no onError, but no reachable
   path in the current TwelveDataProvider/AlpacaProvider implementations
   ever calls addError on those specific streams - left unchanged rather
   than adding untestable defensive code for a currently-unreachable
   case.
4. Previously flagged, still open, still out of scope: Portfolio/Alerts
   symbol pickers use MockMarketCatalog for symbol-name text only (not
   price) - reviewed again this pass, unchanged, still an accepted
   "symbol-name registry" allowance.

NEXT:
Claude has completed this audit and stopped, per its own instruction. No
further improvement loop started. Items 2 and 3 above are flagged for
GPT/Mac to decide whether they warrant a future task. Waiting for GPT/Mac
review.
