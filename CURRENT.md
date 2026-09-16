PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Hybrid Provider Architecture (Twelve Data + Alpaca)
TITLE: Implement per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_HYBRID_PROVIDER_ARCHITECTURE_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 8142dff
BACKEND DEPLOYS: mkr-backend Cloudflare Worker deployed once this pass -
Version ID 6a57a22b-042f-45af-bcd2-54380b36d190. Confirmed live bindings:
HYBRID_ROUTING_ENABLED="false", HYBRID_CRYPTO_ROUTING_ENABLED="false",
MARKET_SECONDARY_ENABLED="false" (all unchanged/off - safe deploy). MKR's
own isolated Worker only; no other app/account resource affected.

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_HYBRID_PROVIDER_ARCHITECTURE_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Post-Phone Closed Testing Correction pass, completed, was
WAITING_FOR_GPT_REVIEW (commit e7c6918). This pass builds on that baseline
without altering any of its fixes.

THIS PASS - one consolidated Hybrid Provider Architecture implementation,
per the task file, evolving provider selection from simple Primary/
Secondary failover into a capability-aware Hybrid Provider Router, while
keeping the entire existing Market Pool/cache/single-flight/SWR/circuit-
breaker/quota-manager/server-side-pooling architecture fully intact (none
of it removed or forked).

ARCHITECTURE (see full report for details):
- New backend/src/providers/capability.ts - pure capability/preference/
  activation model. Capability = D1 alpaca_symbol mapping presence
  (schema.sql seed data already correctly scopes this to us_stock/crypto
  only - no second hard-coded catalog needed). Preference = which provider
  tried first, given capability. Activation = existing secondaryEnabled
  flag, re-checked independently as defense-in-depth. Crypto has its own
  separate, more conservative flag - never inferred from asset-class name
  alone.
- provider-manager.ts: new routeSlots(preferredProvider?) generalizes the
  old hard-coded primary-then-secondary order into a 0-2 slot list.
  withFailover/batchWithFailover rewritten to walk it. Preserved a subtle
  pre-existing asymmetry (found via test failures, then fixed): primary
  never throws its own error from the loop (always falls through to the
  shared generic fallback); secondary throws its own error only when it
  is ALSO the last slot in that call's ordering - keeps non-hybrid
  behavior byte-identical while letting a hybrid-swapped Alpaca-preferred
  call correctly fall back to Twelve Data.
- getBatchQuotes: split-batch routing for mixed preferences within one
  call - two Promise.allSettled sub-calls (one per provider group), each
  self-healing independently via its own routeSlots fallback, merged by
  Object.assign; a group's outage never silently drops the other group's
  symbols.
- Two new feature flags (both default false): hybridRoutingEnabled
  (master switch), hybridCryptoRoutingEnabled (crypto's own separate
  gate). Wired through defaults.ts/types.ts/wrangler.toml, admin-editable
  via the existing generic featureFlags shallow-merge (no new validation
  code needed).
- market-routes.ts: preferredProviderForRow() wired into handleQuote/
  handleQuotes/handleCandles. handleMarketStatus/handleMarketHealth/
  handleMarketSymbols unchanged (getMarketStatus never really calls
  Alpaca).
- New GET /api/mkr/admin/alpaca-capability-test admin route (existing
  requireAdmin auth reused) - read-only, real sequential Alpaca REST
  calls (AAPL/MSFT/NVDA/QQQ/TSLA/BTC-USD/ETH-USD) against the actual
  AlpacaProvider class when configured, classifying each outcome
  (works/no_data/capability/auth/rate_limit/transient/error). Reports
  configured:false with the exact operator step when secrets are absent
  - never invents values, never blocks the task.
- Deliberately NOT wired this pass: MarketStreamRoom's live WebSocket
  upstream stays Twelve-Data-only. Real-time Alpaca streaming to end
  users is exactly the kind of "public display" the licensing guard
  warns about; capability.ts's canStream('alpaca', ...) honestly always
  returns false rather than silently omitting the question. Only the
  DO's one historical-seed REST call goes through the shared provider
  manager, left without a preference (avoids mixing provider shapes in
  one aggregator slot).
- Flutter: ZERO code changes needed - twelve_data_parser.dart:259 already
  maps 'alpaca' => MarketDataSource.alpaca; source field already flows
  correctly end-to-end through the existing shared parser/cache.

ALPACA PRODUCTION ROUTING: DISABLED. Both new flags default false,
MARKET_SECONDARY_ENABLED unchanged/false, and ALPACA_API_KEY_ID/
ALPACA_API_SECRET_KEY are NOT configured on the deployed Worker (confirmed
via wrangler secret list). No live Alpaca capability test was run against
a real account - honestly reported as not-yet-tested, not fabricated.

LICENSING/DISPLAY-RIGHTS GATE (explicitly unresolved, by design): a
successful capability test alone never justifies enabling public Alpaca
routing. Current Alpaca Paper account tier / Twelve Data plan commercial
redistribution rights to MKR end users have not been confirmed. This
remains an explicit operator/product release decision, separate from and
after any technical capability test.

OPERATOR STEPS STILL REQUIRED (no secret values ever printed/logged):
1. wrangler secret put ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY on
   mkr-backend.
2. Call GET /api/mkr/admin/alpaca-capability-test (admin session) and
   review real per-symbol results.
3. Only after reviewing results AND confirming the licensing gate above:
   explicitly set HYBRID_ROUTING_ENABLED (and, separately,
   HYBRID_CRYPTO_ROUTING_ENABLED if crypto routing is also wanted) and
   MARKET_SECONDARY_ENABLED to "true" in wrangler.toml. All three gates
   require independent, explicit operator action - nothing in this pass
   flips them automatically.

REGRESSION:
- Backend: 568/568 passing (46 test files) - added capability.test.ts
  [11], admin-alpaca-capability-routes.test.ts [3], ~15 new tests in
  provider-manager.test.ts, 6 new hybrid integration tests in
  market-routes-quote-cache.test.ts, 1 fixture fix in
  config-service.test.ts. Zero existing assertions weakened. TypeScript
  typecheck clean.
- Flutter: 357/357 passing, zero regressions (no Flutter source files
  touched this pass). flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release: both
  succeed (AAB 54.3MB).
- Security scan: git diff grepped for credential patterns - only fake
  test placeholders ('fake-id-not-real' etc.) and env-var NAMES
  (ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY), zero real secret values.
  MockMarketCatalog grep: all usage pre-existing, demo-mode-scoped,
  unchanged from prior-turn baseline (no Flutter files modified).

PRODUCTION:
- mkr-backend Cloudflare Worker deployed this pass (Version ID
  6a57a22b-042f-45af-bcd2-54380b36d190) - safe, all new flags off.
- Live smoke (post-deploy): /api/mkr/market/health -> secondary: null
  (correct, Alpaca not activated); /api/mkr/market/quote?symbol=AAPL ->
  source: "twelve_data" (confirms hybrid routing did not engage, as
  expected); /api/mkr/admin/alpaca-capability-test (no admin session) ->
  401 (route registered, correctly auth-protected, not a stray 404/500).
  Safe-disabled behavior confirmed on the live deployment.

NEXT:
Claude has completed this pass and stopped, per its own instruction (one
consolidated Hybrid Provider Architecture pass - no serial micro-fixes
started after). Waiting for GPT/Mac review, and for the operator steps
above (secrets -> capability test -> licensing review -> explicit flag
flips) before any Alpaca production routing is enabled.
