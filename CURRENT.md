PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Final Release Gate One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FINAL_RELEASE_GATE_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: (recorded below after commit)
BACKEND DEPLOYS: mkr-backend Cloudflare Worker deployed once this pass -
Version ID 022c4dfc-40c2-4699-a989-cbd2de9f950d. Confirmed live bindings:
HYBRID_ROUTING_ENABLED="false", HYBRID_CRYPTO_ROUTING_ENABLED="false",
MARKET_SECONDARY_ENABLED="false" (all unchanged/off - safe deploy).

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FINAL_RELEASE_GATE_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Final Full-System One-Pass, completed, was WAITING_FOR_GPT_REVIEW
(commit 72fcf42). Note: the task file this pass named
(GPT_TO_CLAUDE_MKR_FINAL_RELEASE_GATE_ONE_PASS.md) did not exist at the
start of the turn; the user confirmed creating it, and while a version was
being drafted the real file appeared on disk and was used as authoritative
instead.

THIS PASS - a release-gate-focused re-audit of 4 named areas (/quotes
source semantics, stale-cache semantics, hybrid routing, Closed Testing
readiness) plus a fresh Flutter real-mode pass, run in parallel (2
background agents + 4 tracks done directly), findings consolidated, then
every material finding fixed together in one pass.

MATERIAL FINDINGS FIXED (full detail in the report):
1. /quotes envelope-level `source` field was a static lie - always
   reported config.primaryProvider regardless of what actually resolved
   each item, even though hybrid routing + the prior pass's cross-provider
   batch fallback can genuinely produce a mixed-provider batch. Not
   consumed by Flutter (confirmed), but still false. Fixed: new
   envelopeSourceFor() derives it from each item's own real source -
   single honest provider when all agree, null when mixed/nothing
   resolved.
2. Cache terminology correction: the prior pass's bounded stale-fallback
   mechanism was documented/tested as "stale-while-revalidate" throughout,
   which is the wrong name - it's a synchronous fallback on a FAILED fresh
   fetch, never background revalidation. Renamed throughout per the
   task's own explicit instruction ("align naming... rather than
   inventing background work"). Zero behavior change.
3. Hybrid routing - re-confirmed correct end-to-end, no bug found.
4. AlpacaProvider's WebSocket reconnect was permanently broken - no
   onError/onDone handler meant a dropped connection left _channel
   non-null forever, permanently blocking every future reconnect.
   Currently unreachable in production (Alpaca defaults inactive), but a
   real bug in code that exists specifically to be activated later. Fixed
   by mirroring TwelveDataProvider's existing correct reset-then-retry
   pattern.
5. Found WHILE WRITING THE TEST for #4: both TwelveDataProvider and
   AlpacaProvider reset their reconnect backoff counter the moment a
   socket object was merely constructed, not when the connection was
   actually confirmed alive - a rapidly flapping connection could never
   accumulate backoff. Fixed by moving the reset to the first genuinely
   received frame in both providers.
6. TwelveDataProvider's WS reconnect retried forever with zero
   user-visible signal - the onError forwarding already built into
   provider_backed_market_service.dart/MarketDetailController for exactly
   this was effectively dead code, since nothing ever called
   _quoteController.addError. Fixed: after 3 consecutive failed reconnect
   attempts (~15s), one error surfaces; reconnection continues
   unaffected, later success naturally recovers the UI state.
7. MarketProviderManager's own re-subscription to the underlying
   provider's stream had NO onError at all - even with #6 fixed, the
   error became an unhandled zone error at exactly this one missing link
   instead of ever reaching the layers above (which were already
   correctly built). Fixed: onError forwarding added at both
   watchQuotes/watchCandles re-subscription points, completing the chain.
8. Closed Testing: one small, safe hardening - android/build.gradle.kts's
   silent fallback to debug signing when key.properties is absent now
   prints a build-time warning. Zero behavior change to the signing logic
   itself.

NOT CHANGED (re-audited, confirmed correct/unchanged, no bug found):
Hybrid routing matrix and bounded per-symbol batch fallback from the
prior pass. All 6 Flutter real-mode fixes from the prior pass (disposal
guard, MarketDataSource.unavailable, real-catalog pickers, request-
generation guards) - spot-checked intact. No remaining unconditional
MockMarketCatalog usage in any real-mode path. Source attribution
survives intact end-to-end. API/error/no-data contract - no silent symbol
disappearance, no transient-failure negative-caching.

CLOSED TESTING RELEASE GATE: both prior BLOCKING items unchanged, both
genuinely operator/product-owned - android/key.properties (real release
keystore) missing; MockBillingRepository wired unconditionally, no real
Play Billing dependency (paywall already discloses this honestly to
testers via an explicit "no payment is processed in this build" dialog,
in English and Thai). Non-blocking items (AdMob placeholder, Supabase
dart-define requirement) unchanged.

ALPACA CAPABILITY TEST: still operator-blocked. wrangler secret list
confirms ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY remain unconfigured -
unchanged from every prior pass. Exact commands (from backend/):
  wrangler secret put ALPACA_API_KEY_ID
  wrangler secret put ALPACA_API_SECRET_KEY
Then call GET /api/mkr/admin/alpaca-capability-test (admin session).

PRODUCTION FLAGS: HYBRID_ROUTING_ENABLED, HYBRID_CRYPTO_ROUTING_ENABLED,
MARKET_SECONDARY_ENABLED all confirmed "false" post-deploy. Nothing in
this pass touches any of them. Live smoke confirms zero Alpaca traffic.

LICENSING/DISPLAY-RIGHTS GATE: unchanged, unresolved by design.

REGRESSION:
- Backend: 606/606 passing (48 test files, +3 new envelope-source-
  truthfulness tests). npm run typecheck: clean. Also fixed a genuine,
  previously-latent test-isolation gap in market-routes-quote-cache.test.ts
  (no circuit-breaker/health/quota reset between tests), exposed by one of
  this pass's own new tests - now matches the established reset pattern
  already used elsewhere.
- Flutter: 369/369 passing (363 baseline + 6 new: 2 TwelveDataProvider WS
  tests, 2 AlpacaProvider WS tests, 2 MarketProviderManager error-
  forwarding tests). flutter analyze: no issues found. fake_async
  promoted from transitive to a direct dev_dependency.
- flutter build apk --debug and flutter build appbundle --release
  (54.3MB): both succeed.
- Security scan: git diff grepped for credential patterns - zero real
  secret values. git status confirms all 13 changed files are within
  D:\FlutterProjects\mkr only - auc/backend untouched.

PRODUCTION:
- mkr-backend Cloudflare Worker deployed this pass (Version ID
  022c4dfc-40c2-4699-a989-cbd2de9f950d) - safe, all gates still off.
- Live smoke (post-deploy): /market/health -> secondary: null;
  /market/quote?symbol=AAPL -> source: "twelve_data"; /market/quotes
  (AAPL,NVDA,BTC) -> all 3 resolved, errors:[], noData:[], envelope
  source now genuinely computed ("twelve_data", truthfully, not assumed);
  /market/candles -> real OHLC data; /calendar/events?range=today -> real
  curated events; /admin/alpaca-capability-test (no session) -> 401,
  correctly auth-protected.

REMAINING RISKS / OPERATOR ACTIONS:
1. Provision Alpaca secrets, then run the real capability test.
2. Generate and safeguard a real Android release keystore
   (android/key.properties from the existing template).
3. Decide on real Play Billing integration, or explicitly scope Closed
   Testing to exclude monetization verification.
4. Licensing/display-rights review for Alpaca before any hybrid flag is
   ever flipped.

READINESS: technically ready for Closed Testing at the code level. The
two remaining blockers are correctly operator/product-owned, not code
defects - everything else raised by this pass has been fixed and
verified.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no intermediate stop, no new GPT_TO_CLAUDE sub-task created.
Waiting for GPT/Mac review, and for the operator actions above.
