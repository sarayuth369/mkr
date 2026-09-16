PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Final Full-System One-Pass Audit + Integrated Fix
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FINAL_FULL_SYSTEM_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: (recorded below after commit)
BACKEND DEPLOYS: mkr-backend Cloudflare Worker deployed once this pass -
Version ID af70184d-de35-4daf-a954-b4df48c0f39d. Confirmed live bindings:
HYBRID_ROUTING_ENABLED="false", HYBRID_CRYPTO_ROUTING_ENABLED="false",
MARKET_SECONDARY_ENABLED="false" (all unchanged/off - safe deploy).

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FINAL_FULL_SYSTEM_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Hybrid Capability Validation + Crypto Endpoint Correction pass,
completed, was WAITING_FOR_GPT_REVIEW (commit 8e72d6a). This task
SUPERSEDES the prior serial-style approach: one full-system parallel audit
across 10 tracks, all findings collected before any edit, then every
material finding integrated into ONE fix pass - no stopping mid-way, no
sub-task chain.

METHOD: 5 background audit agents launched in parallel (Market Pool/cache/
quota/circuit; API routes + Calendar/News/AI; Flutter Home/Markets/Detail/
Watchlist/Portfolio; Flutter Alerts/Calendar/News/AI/Premium; Closed
Testing readiness) plus direct audit of the Hybrid provider/critical-batch-
check/streaming-boundary tracks (fresh context from the prior 3 passes).
All findings consolidated before any code change.

MATERIAL FINDINGS FIXED (full detail in the report):
1. Backend CRITICAL BATCH CHECK (self-identified): batchWithFailover
   returned on the first non-throwing provider attempt even when that
   response was PARTIAL (some symbols missing from an otherwise-successful
   batch) - no chance for those symbols to retry against a healthy, mapped
   OTHER provider. Fixed with a bounded per-symbol fallback: tracks
   `remaining` symbols, asks each subsequent slot only for what's still
   missing, max one extra attempt per symbol, never retries confirmed
   no-data, never contacts a slot once nothing remains.
2. Backend: cache-service.ts had NO stale-while-revalidate despite it
   being a documented invariant - a provider outage on an already-expired
   KV entry was a hard failure. Fixed: entries now carry storedAt + a
   120s grace window on physical TTL; a failed refetch falls back to the
   still-present stale value instead of throwing. Legacy entries with no
   storedAt are trusted as fresh (no refetch storm on this deploy).
3. Backend: /quote and /quotes didn't share an in-flight coalescing key
   for the same single symbol - fixed by routing a lone uncached /quotes
   symbol through the exact same cachedFetch call /quote uses.
4. Backend: confirmed no-data quotes vanished from /quotes responses
   entirely (neither items nor errors) - new explicit `noData: string[]`
   field, additive, non-breaking.
5. Flutter: MarketDetailController had no disposal guard - backing out of
   the detail screen while an async load was in flight could throw "used
   after disposed". Fixed with a _disposed flag checked before every
   post-await notifyListeners().
6. Flutter: unrecognized/backend-'unavailable' source values were
   mislabeled MarketDataSource.demo (conflating real-mode-unknown with
   mock data). New MarketDataSource.unavailable value added.
7. Flutter: CreateAlertScreen's symbol picker used MockMarketCatalog
   unconditionally in real mode (wrong symbol universe, crash risk via
   DropdownButtonFormField initialValue-not-in-items). Fixed: sourced from
   real MarketService.getCatalog(), same pattern as WatchlistScreen's
   already-fixed _AddSymbolSheet. Same bug found (self-identified, same
   shape) and fixed in PortfolioScreen's _AddHoldingSheet.
8. Flutter: GoldRadarController/CalendarController/NewsController lacked
   the request-generation race guard already established in
   MarketsController._loadRequestId - fixed identically in all three.

NOT CHANGED (audited, confirmed correct, no bug found): Hybrid routing
matrix (capability/preference/activation split, per-symbol fallback within
a routing preference, activation gate) - re-verified intact. Streaming
boundary - MarketStreamRoom remains Twelve-Data-only, not touched.
Calendar timezone logic, News real-mode gating, AI real-mode wiring - all
confirmed correct as-is, not redesigned.

CLOSED TESTING READINESS (audited, not fixed - operator/product scope):
BLOCKING: no android/key.properties (release build falls back to debug
signing - needs the app owner's own real keystore); MockBillingRepository
wired unconditionally, no real Play Billing dependency (purchase flow
doesn't move real money). NON-BLOCKING: AdMob still placeholder (Phase 3,
by design); Supabase features need --dart-define at build time (degrade
gracefully if omitted). Everything else checked out fine (signing config
structure, no hardcoded non-prod URLs, manifest permissions, Firebase
wiring, premium gating, loading/error/empty states, startup failure
handling, no sensitive logging, no committed secrets).

ALPACA CAPABILITY TEST: still operator-blocked. wrangler secret list
confirms ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY remain unconfigured -
unchanged from every prior pass. Claude cannot enter/relay real
credentials into wrangler secret put. Exact commands (from backend/):
  wrangler secret put ALPACA_API_KEY_ID
  wrangler secret put ALPACA_API_SECRET_KEY
Then call GET /api/mkr/admin/alpaca-capability-test (admin session) for
real, family-correct results.

PRODUCTION FLAGS: HYBRID_ROUTING_ENABLED, HYBRID_CRYPTO_ROUTING_ENABLED,
MARKET_SECONDARY_ENABLED all confirmed "false" post-deploy. Nothing in
this pass touches any of them. Live smoke confirms zero Alpaca traffic.

LICENSING/DISPLAY-RIGHTS GATE: unchanged, unresolved by design - a
passing capability test alone never justifies enabling public Alpaca
routing. Remains a separate operator/product decision.

REGRESSION:
- Backend: 603/603 passing (48 test files, net +23 new/updated tests
  across provider-manager.test.ts, cache-service.test.ts,
  market-routes-quote-cache.test.ts). npm run typecheck: clean. Zero
  existing assertions weakened - every test-shape change reflects a
  deliberate behavior change made this pass.
- Flutter: 363/363 passing (357 baseline + 6 new regression tests: gold
  radar race, market detail disposal x2, calendar race x2, news race;
  1 existing test updated for the intentional .demo->.unavailable
  change). flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release
  (54.3MB): both succeed.
- Security scan: git diff grepped for credential patterns - zero real
  secret values. git status confirms all 18 changed/new files are within
  D:\FlutterProjects\mkr only - auc/backend untouched. MockMarketCatalog
  grep: create_alert_screen.dart/portfolio_screen.dart now appear only in
  doc comments explaining the fix, zero remaining actual-code usage.

PRODUCTION:
- mkr-backend Cloudflare Worker deployed this pass (Version ID
  af70184d-de35-4daf-a954-b4df48c0f39d) - safe, all gates still off.
- Live smoke (post-deploy): /market/health -> secondary: null;
  /market/quote?symbol=AAPL -> source: "twelve_data"; /market/quotes
  (AAPL,NVDA,BTC) -> all 3 resolved, errors:[], new noData:[] field
  present; /market/candles -> real OHLC data; /calendar/events?range=today
  -> real curated events; /admin/alpaca-capability-test (no session) ->
  401, correctly auth-protected.

REMAINING RISKS / OPERATOR ACTIONS:
1. Alpaca real capability test - needs operator secret provisioning.
2. Closed Testing release keystore + real Play Billing wiring - operator/
   product-owned, not something Claude generates/wires without real
   credentials.
3. CreateAlertScreen/PortfolioScreen's real-catalog fix has no new
   dedicated widget-level test this pass (verified via analyze + full app
   test suite instead) - mirrors the already-tested WatchlistScreen
   pattern exactly.
4. Stale-while-revalidate's 120s grace window is a documented, deliberate
   default, not empirically tuned against a specific SLA.
5. Alpaca crypto WebSocket streaming remains out of scope (unchanged).

NEXT:
Claude has completed this ONE consolidated pass and stopped, per its own
instruction - no serial loop, no intermediate stop, no new GPT_TO_CLAUDE
sub-task created. Waiting for GPT/Mac review, and for the operator to
provision Alpaca secrets + release signing/billing before further
production decisions.
