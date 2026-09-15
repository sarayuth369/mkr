PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Post-Audit Final Stability Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_POST_AUDIT_FINAL_STABILITY_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_POST_AUDIT_FINAL_STABILITY_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Pre-Closed-Testing Full Stability Audit, completed, was
WAITING_FOR_GPT_REVIEW (commit 9410719). Mac raised 4 concrete findings
against that post-audit code for one consolidated final pass.

THIS PASS - fixed all 4 findings in one coherent change:

Finding 1 - _handleFailure() discarded chained future:
`_failureHandlingFuture ??= _doHandleFailure(failed).whenComplete(...)` -
the exact unlistened-chained-future hygiene bug already fixed elsewhere
in this codebase (quote single-flight, MarketCatalogRepository). Fixed
with the identical single-async-wrapper + try/finally pattern. De-dup
semantics unchanged.

Finding 2 - live subscriptions leaked after cancellation:
TwelveDataProvider._subscribedSymbols only ever grew -
TwelveDataProvider.unsubscribe(symbol) existed but was NEVER CALLED
anywhere (confirmed dead code via grep before touching it); AlpacaProvider
had no such method at all. A symbol, once watched by any screen, stayed
subscribed on the backend for the rest of the session regardless of
whether anyone still needed it. Fixed: added
unsubscribeQuotes(List<String>) to the MarketDataProvider interface
(batch-shaped like watchQuotes), implemented it in both real providers
(the dead single-symbol method became the real batch one for Twelve
Data; new symmetric no-op-when-inactive implementation for Alpaca) and
as a no-op in DemoMarketDataProvider. MarketProviderManager.watchQuotes/
watchCandles converted from thin async* pass-throughs into explicit
StreamController-based methods with a shared per-symbol reference count
- a symbol is only released (unsubscribeQuotes called) once the LAST
subscriber referencing it cancels; watchCandles shares the SAME counter
as watchQuotes since both providers' watchCandles rides the same
per-symbol quote subscription internally.

Finding 3 - stream controllers left open on cancellation:
ProviderBackedMarketService.watchQuotes/watchCandles's onCancel only
cancelled the inner subscription, never closed the controller itself -
an abandoned controller could accumulate across repeated screen
creation/cancellation. Fixed: onCancel now explicitly closes the
controller too, at BOTH the service layer AND the new manager-layer
controllers introduced for Finding 2 (so Finding 2's fix didn't
introduce a fresh instance of Finding 3's own bug at a different layer).
Once closed, a controller can never be re-listened to - a genuine
re-subscribe always goes through a fresh watchQuotes()/watchCandles()
call, matching how every real caller already uses these methods.

Finding 4 - asset-class classification still depended on
MockMarketCatalog: TwelveDataProvider._assetClassFor()/
AlpacaProvider._assetClassFor() both fell back to
MockMarketCatalog.bySymbol(...)?.assetClass ?? AssetClass.usStock - a
symbol the BACKEND catalog enables but the mock registry never carried
was silently misclassified as usStock, including for live quotes. Fixed
by reusing the existing real-mode authority: MarketCatalogRepository
gained a synchronous cachedSymbols getter (a peek at whatever was last
successfully loaded, ignoring the 5-minute price-freshness TTL since
asset class doesn't go stale like price does); both providers now take a
required MarketCatalogRepository and classify from cachedSymbols,
falling back to usStock only as a genuine last resort - never a second
hard-coded production catalog. app.dart now builds the catalog FIRST and
shares it with both providers (previously only built afterward for
ProviderBackedMarketService).

ALSO RE-CHECKED (per the task's explicit list), found already clean: no
false success/empty/stale-LIVE regressions (full prior regression suite
still green, unchanged); no new mock contamination (final grep re-audit
below); no new unhandled futures/timers/subscriptions in changed paths
(every new async callback fully awaited, no discarded chained futures);
candle validation/envelope behavior from b064a8d and later fully intact
(those test files pass unchanged, only the constructor signature update
was mechanical).

FINAL GREP RE-AUDIT: MockMarketCatalog usage across lib/features is
identical to every prior audit's classification EXCEPT the two provider
_assetClassFor methods, whose real code usage is now gone entirely -
only doc-comment mentions remain. Zero remaining real-mode
price/chart/trend/P&L/alert/classification use.

REGRESSION:
- Backend: 525/525 passing, read/verified only - no backend files
  touched. TypeScript typecheck clean.
- Flutter: 330/330 passing (13 new across 5 test files: 2 for Finding 1,
  4 for Finding 2, 1+2 for Finding 3 (manager + service layer), 4 for
  Finding 4 in new test/logic/provider_asset_class_test.dart). No
  existing test weakened or deleted - 4 existing test files needed a
  mechanical constructor-argument update (the new required catalog:
  param), zero assertions changed. `flutter analyze`: no issues.
  `flutter build apk --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped to exactly 8 production files and 6 test
  files (618 insertions, 36 deletions); no Market Pool, Firebase/FCM,
  Economic Calendar, News Radar, Supabase, or backend changes;
  auc/backend untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. Entirely
  frontend-only.
- Live smoke check performed: /api/mkr/health OK; /api/mkr/market/symbols
  OK; /api/mkr/market/quotes?symbols=AAPL,BTC OK real live data.

REMAINING LIMITATIONS (real, not hand-waved):
1. No wire-level (WebSocket message) test for either provider's
   unsubscribeQuotes - this codebase has no existing WebSocket-channel-
   faking harness for either provider (subscribe was never wire-tested
   either), and building one just for this fix would be disproportionate.
   Coverage is via the manager-level reference-counting tests (where the
   actual decision logic lives) plus direct code inspection of the two
   simple, symmetric implementations.
2. AlpacaProvider's asset-class test uses a deliberately artificial
   stubbed category (BTC as "forex" instead of its real "crypto") to
   prove the classification source changed, since every symbol Alpaca's
   SymbolMapper covers already exists in MockMarketCatalog with the same
   category in practice - there is no currently-real "Alpaca-mapped
   symbol absent from the mock registry" scenario to test non-
   artificially. Documented in the test's own comment.
3. MarketCatalogRepository.cachedSymbols deliberately ignores the
   5-minute freshness TTL (asset class doesn't go stale like price does)
   - meaning a provider could theoretically classify from a catalog
   snapshot technically past the TTL used for pricing decisions
   elsewhere. Considered acceptable, noted rather than silently assumed
   away.

NEXT:
Claude has completed this pass and stopped, per its own instruction. No
further improvement loop started. Waiting for GPT/Mac review.
