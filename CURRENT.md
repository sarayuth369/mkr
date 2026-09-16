PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Home/Markets Final User-Visible Audit
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_HOME_MARKETS_FINAL_USER_VISIBLE_AUDIT_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 437909d

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_HOME_MARKETS_FINAL_USER_VISIBLE_AUDIT_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Post-Audit Final Stability Pass, completed, was WAITING_FOR_GPT_REVIEW
(commit 5c57553). Mac asked for one consolidated final pass focused on the
user-visible symptom: Home and Markets can open with no market content.

THIS PASS - traced the real production path end-to-end against the
deployed backend and fixed every concrete root cause in one coherent
change:

ROOT CAUSE (primary) - confirmed LIVE, reproducible: the deployed backend's
batch quotes endpoint (GET /api/mkr/market/quotes) can return
success:true with a requested symbol present in NEITHER data.items NOR
data.errors. Reproduced twice in a row during this pass's own live-smoke
testing on Home's exact post-catalog-filter symbol set
(XAU/USD,BTC,SET -> items:[XAU/USD], errors:[], BTC/SET silently gone).
This is a backend/upstream-provider (Twelve Data free tier)
data-availability characteristic, not fixable from the frontend and
auc/backend is off-limits - so the frontend now represents it honestly
instead of masking it: TwelveDataParser.parseQuotesBatchResult takes a new
required requestedSymbols parameter and reconciles resolved quotes against
it - any requested symbol silently absent from both items and errors is
folded into failedSymbols. A partially-silent batch becomes an honest
MarketFetchPartial (valid quotes still render, degraded indicator shown)
instead of a misleadingly "clean" success; a wholly-silent batch becomes an
honest MarketFetchFailure instead of a false empty state. AlpacaProvider
.getQuotes got the symmetric fix for consistency (dormant standby, no
current production impact).

Item 2 - silent stream hang when no provider is available:
MarketProviderManager.watchQuotes/watchCandles previously just returned
inside onListen when _active == null after ensureConnected() - a listener
got no data/error/done and stayed open forever, indistinguishable from
"market quiet". Now calls controller.addError(...) to surface the fault
honestly. Same gap found and fixed one layer up in
ProviderBackedMarketService's inner .listen() calls (no onError handler -
a manager-level error would have become an unhandled zone error instead of
reaching HomeController/MarketDetailController).

Item 3 - overlapping refresh races: HomeController.refresh() and
MarketsController._load() had no protection against a slower, older call
overwriting a newer result (e.g. pull-to-refresh tapped twice). Both now
use a request-generation-id guard, reusing the pattern already proven for
MarketDetailController.loadSeries, plus a minimal disposal guard.

Items 4/5/6 - verified already correct: Home's curated-symbol resolution
and Markets' partial/failure ApiState mapping (both from earlier passes)
are structurally sound - the actual gap was one layer down in the parser
(the primary fix above); both now receive honest data. Item 2's fix is
itself the item-6 regression check (a gap in the immediately preceding
pass's ref-counting work).

REGRESSION:
- Backend: 525/525 passing, read/verified only - no backend files
  touched. TypeScript typecheck clean.
- Flutter: 349/349 passing (18 new tests across 6 files: 4 for the
  parser reconciliation fix + 7 existing call sites updated, 6 for
  AlpacaProvider.getQuotes (previously zero coverage), 3 for the
  manager-level silent-hang fix, 2 for the service-level onError
  forwarding fix, 2 for HomeController's race guard, 2 for
  MarketsController's race guard). No existing test weakened or deleted;
  one test's expectation was corrected from MarketFetchEmpty to
  MarketFetchFailure (it asserted the bug being fixed). `flutter
  analyze`: no issues. `flutter build apk --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped to exactly 7 production files and 6 test
  files (602 insertions, 30 deletions); no Market Pool, infra, paid
  provider, Firebase/FCM, News, Calendar, or backend changes;
  auc/backend untouched.
- Final mock-data grep: MockMarketCatalog references across
  lib/features/** are pre-existing doc-comment mentions or the standalone
  demo implementation only - no real-mode usage introduced.

PRODUCTION:
- No backend changes this pass - nothing to deploy. Entirely
  frontend-only.
- Live smoke check performed: /api/mkr/market/health OK (primary
  twelve_data, circuit closed, rate-limit noted in lastErrorMessage);
  /api/mkr/market/symbols OK (20 enabled symbols, confirms SPX/NDX/DJI
  genuinely absent from the real catalog); /api/mkr/market/quotes for the
  full 20-symbol catalog (8 items/12 errors/0 silently-missing this run);
  /api/mkr/market/quotes for Home's exact resolved symbol set
  (XAU/USD,BTC,SET) reproduced the silent-drop root cause live, twice.

REMAINING LIMITATIONS (real, not hand-waved):
1. The underlying backend/provider data-availability gap cannot be fixed
   from the frontend (auc/backend off-limits, no paid provider) - this
   pass makes the degraded state honest and visible, it does not make more
   data available from Twelve Data's free tier.
2. The silent-drop behavior is intermittent, not constant - it reproduced
   twice on Home's 3-symbol set but 0 times on a same-session 20-symbol
   full-catalog call. The fix handles it correctly whenever it occurs.
3. The item-2 "second listen() onError forwarding" fix in
   ProviderBackedMarketService.watchCandles (the live-tick tail, after
   historical fetch already succeeded) covers a narrow timing race for
   defensive symmetry with watchQuotes; its regression test exercises the
   equivalent "no provider available throughout" scenario (which fails
   earlier, at the historical fetch) rather than that exact narrow window,
   since reproducing the precise race deterministically would need a more
   elaborate test double than proportionate to the fix's size. The code
   itself is a direct, mechanical copy of the already-tested watchQuotes
   fix.

NEXT:
Claude has completed this pass and stopped, per its own instruction. No
further improvement loop started. Waiting for GPT/Mac review.
