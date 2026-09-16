PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Hybrid Capability Validation + Crypto Endpoint Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_HYBRID_CAPABILITY_VALIDATION_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: (recorded below after commit)
BACKEND DEPLOYS: mkr-backend Cloudflare Worker deployed once this pass -
Version ID d7dce600-1f16-4223-ab16-5188656be076. Confirmed live bindings:
HYBRID_ROUTING_ENABLED="false", HYBRID_CRYPTO_ROUTING_ENABLED="false",
MARKET_SECONDARY_ENABLED="false" (all unchanged/off - safe deploy). MKR's
own isolated Worker only; no other app/account resource affected.

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_HYBRID_CAPABILITY_VALIDATION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Hybrid Provider Architecture pass, completed, was
WAITING_FOR_GPT_REVIEW (commit 6db63ce). Mac's review found a material
issue: AlpacaProvider used the stock API base URL for the crypto
capability-test symbols BTC/USD and ETH/USD too, which is wrong for
Alpaca's real crypto market data endpoints.

THIS PASS - one consolidated fix: corrected AlpacaProvider to route by
asset/data family (stock vs crypto), so the capability test can eventually
give a truthful crypto result once real credentials are provisioned.

ROOT CAUSE (confirmed exactly as Mac described): AlpacaProvider used
https://data.alpaca.markets/v2/stocks for every symbol, including BTC/USD
and ETH/USD. Alpaca's real crypto market data lives under a separate API
family, https://data.alpaca.markets/v1beta3/crypto/us/..., with a
different response shape (crypto snapshots/bars are always keyed by
symbol under snapshots/bars, even for one symbol - stock's shape is flat).

FIX:
- New isAlpacaCryptoSymbol(providerSymbol) in alpaca-parser.ts:
  providerSymbol.includes('/') - reuses the existing D1 alpaca_symbol
  mapping shape as the signal (crypto rows are seeded "BTC/USD"-style,
  us_stock rows are bare tickers - schema.sql) instead of inventing a
  second catalog/asset-class parameter.
- AlpacaProvider.getQuote/getCandles now dispatch internally by symbol
  shape - stock family unchanged (/v2/stocks/{symbol}/snapshot, /bars);
  new crypto family (/v1beta3/crypto/us/snapshots?symbols=,
  /bars?symbols=). Not hard-coded only in the admin route - the provider
  itself knows.
- New parseAlpacaCryptoSnapshot/parseAlpacaCryptoBars unwrap the
  snapshots[symbol]/bars[symbol] map, then share the same parsing core as
  the stock parsers - identical NormalizedQuote/NormalizedCandle shape,
  source: 'alpaca', for both families.
- getBatchQuotes now groups crypto entries into ONE real multi-symbol
  request (Alpaca's crypto snapshot endpoint genuinely supports
  comma-separated symbols - materially reduces request count), while
  stock entries keep the existing sequential per-symbol-isolated behavior
  unchanged. A total failure in one family group never affects the other.
- /api/mkr/admin/alpaca-capability-test needed no routing-logic change
  (the provider already dispatches correctly) - added a `family:
  'stock'|'crypto'` field per result, derived from the same symbol-shape
  check, so results clearly identify which endpoint family was actually
  exercised.

ALPACA REAL CAPABILITY TEST: STILL NOT RUN. wrangler secret list confirms
ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY remain unconfigured on the Worker.
Per this session's security rules, Claude cannot enter/relay the user's
real Alpaca credentials into wrangler secret put - that is the operator's
own action, to be run directly in their terminal so the secret never
passes through this session. Exact commands (from backend/):
  wrangler secret put ALPACA_API_KEY_ID
  wrangler secret put ALPACA_API_SECRET_KEY
After running both, call GET /api/mkr/admin/alpaca-capability-test (admin
session) to get real, now family-correct results for AAPL/MSFT/NVDA/QQQ/
TSLA (stock) and BTC/ETH (crypto).

HYBRID ROUTING GATE: unchanged, still fully disabled. All three gates
(HYBRID_ROUTING_ENABLED, HYBRID_CRYPTO_ROUTING_ENABLED,
MARKET_SECONDARY_ENABLED) remain false. Nothing in this pass touches them.
Enabling requires, in order: (1) secrets provisioned, (2) real capability
test reviewed, (3) licensing/display-rights confirmed (unresolved, by
design - a passing capability test alone never justifies enabling public
routing), (4) explicit operator flag flips.

EXISTING ARCHITECTURE: confirmed intact - this pass touched only
alpaca-parser.ts, alpaca-provider.ts, and the admin capability-test route.
provider-manager.ts, market-routes.ts, market-stream-do.ts,
cache-service.ts, circuit-breaker.ts, quota-manager.ts all unmodified.
Quota accounting verified correct: a crypto batch of N symbols now
records exactly 1 real request (one HTTP call), not N. Streaming
(MarketStreamRoom) not touched, still Twelve-Data-only.

REGRESSION:
- Backend: 591/591 passing (48 test files, net +23 new tests -
  alpaca-parser.test.ts crypto snapshot/bars parsing + isAlpacaCryptoSymbol
  [15 new], new alpaca-crypto-endpoint.test.ts [8 tests: stock vs crypto
  URL selection, mixed-batch request counting, per-family failure
  isolation], admin-alpaca-capability-routes.test.ts strengthened with
  family-correct stub + family field assertions). Zero existing
  assertions weakened; all pre-existing Alpaca tests pass unmodified
  (their symbols are all stock-shaped, byte-identical behavior).
  TypeScript typecheck clean.
- Flutter: 357/357 passing, zero regressions (no Flutter files touched).
  flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release: both
  succeed.
- Security scan: git diff grepped for credential patterns - zero real
  secret values, only fake test placeholders and env-var NAMES.
  MockMarketCatalog grep: unchanged (31 pre-existing references, no
  Flutter files modified).

PRODUCTION:
- mkr-backend Cloudflare Worker deployed this pass (Version ID
  d7dce600-1f16-4223-ab16-5188656be076) - safe, all gates still off.
- Live smoke (post-deploy): /api/mkr/market/health -> secondary: null;
  /api/mkr/market/quote?symbol=AAPL -> source: "twelve_data";
  /api/mkr/market/quote?symbol=BTC -> source: "twelve_data" (confirms
  Twelve Data remains current provider for crypto too, and confirms NO
  Alpaca traffic occurs while MARKET_SECONDARY_ENABLED=false);
  /api/mkr/market/symbols -> unchanged; /api/mkr/admin/
  alpaca-capability-test (no admin session) -> 401, correctly
  auth-protected. NOT performed: authenticated real-credential capability
  test run (blocked on operator secret provisioning, see above) and
  direct Alpaca-side AAPL/NVDA/QQQ/BTC-USD/ETH-USD verification - honestly
  reported as not-yet-run, not fabricated.

LICENSING/DISPLAY-RIGHTS GATE: unchanged, still unresolved by design - a
passing capability test alone never justifies enabling public Alpaca
routing to MKR end users. Remains an explicit operator/product decision.

REMAINING LIMITATIONS DEFERRED:
1. Real credentialed capability test not yet run - needs operator action
   (secret provisioning) outside this session.
2. Alpaca crypto WebSocket streaming not investigated/wired - REST only
   this pass; MarketStreamRoom remains Twelve-Data-only.
3. SOL/XRP have D1 alpaca_symbol mappings and will now correctly route
   through the crypto family too, but were not in the required
   capability-test symbol list and were not explicitly live-verified.
4. isAlpacaCryptoSymbol's '/' detection is correct for current D1 seed
   data but is a structural inference from symbol shape, not an explicit
   per-symbol asset-family column - flagged, not fixed (D1 schema is out
   of this task's scope).

NEXT:
Claude has completed this pass and stopped, per its own instruction (one
consolidated crypto-endpoint-correction pass). Waiting for GPT/Mac review,
and for the operator to provision Alpaca secrets before a real capability
test and any hybrid-routing enablement decision can happen.
