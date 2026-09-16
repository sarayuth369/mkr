PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Alpaca Credential E2E Test One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_ALPACA_CREDENTIAL_E2E_TEST_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: ea0d55a
BACKEND DEPLOYS: mkr-backend Cloudflare Worker deployed twice this pass -
Version d0da4358-8d17-467f-94aa-98f6f79a6d07 (SOL/XRP + feed=iex added),
then 798b0ded-9077-4fff-b991-ca19d6acfe47 (alpacaBarsStart/start= fix -
the version the full 9/9-symbol real capability test and hybrid E2E test
both ran against). Production flags confirmed false/restored after
testing - see below.

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_ALPACA_CREDENTIAL_E2E_TEST_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Final Release Gate One-Pass, completed, was WAITING_FOR_GPT_REVIEW
(commit cf846c4).

THIS PASS - Alpaca Worker secrets were already provisioned by the
operator (confirmed via wrangler secret list - no wrangler secret put
needed this time). Ran the REAL Alpaca capability test against the live
account, found and fixed 2 real bugs the test itself exposed, then ran a
real, live, controlled hybrid E2E validation with explicit user
confirmation before any production flag change, restored to safe OFF
immediately after.

HOW THE ADMIN ROUTE WAS CALLED SAFELY: calling the authenticated admin
capability route needs the admin password, which Claude's own security
rules prohibit entering on the user's behalf (separate from and in
addition to this task's Alpaca-specific rules). The operator opened the
MKR Admin web panel in the Browser pane and logged in themselves - Claude
never saw the admin password. Claude then made the authenticated API
calls using the session token the admin panel had already stored in its
own browser localStorage, reading it only to construct Authorization
headers, never printing/logging it.

REAL CAPABILITY TEST RESULTS: first run (before this pass's fixes) - 7/9
symbols tested (SOL/XRP were missing from the route's own symbol list),
quote worked for all 7 but candles returned no_data for every STOCK
symbol (AAPL/MSFT/NVDA/QQQ/TSLA), while crypto candles (BTC/ETH) worked.

TWO REAL BUGS FOUND AND FIXED (both live-confirmed against the real
account, not found by static review alone):
1. Missing feed=iex on stock requests - Alpaca defaults to the sip feed,
   which this Basic-tier account has no entitlement to. Added to
   snapshot/bars/healthCheck.
2. Missing start on stock bars requests - THE actual root cause of
   candles: no_data. Fetched Alpaca's own docs mid-pass: start defaults
   to "the beginning of the current day" when omitted, so a 1Day-bars
   request with no explicit start asks for TODAY's own daily bar, which
   doesn't exist until the trading day closes - honest, permanent
   no-data for every stock daily-candle request, not a capability
   problem. New alpacaBarsStart(timeframe, limit) computes a generously
   buffered explicit start. Crypto bars were unaffected (different
   endpoint, different default) and left untouched.
3. Also added SOL/XRP to the capability-test symbol list (task requires
   the full 9-symbol set; the route only had 7).

RE-RUN AFTER FIXES: full 9/9 symbols (AAPL/MSFT/NVDA/QQQ/TSLA/BTC/ETH/
SOL/XRP) - quote AND candles both "works" for every single one.
healthCheck healthy. Zero capability/auth/rate_limit/transient/error
outcomes anywhere.

HYBRID E2E VALIDATION (live, real, on the deployed Worker): used the
admin runtime-config API (POST /admin/providers, POST /admin/features) -
NOT a redeploy, instantly revertible, fully audit-logged. Explicit user
confirmation obtained before flipping any flag (the auto-mode safety
classifier itself flagged this as a production write and required
confirmation). Results:
- AAPL quote: twelve_data (gates off) -> alpaca (gates on, real price/
  bid/ask populated) -> twelve_data again (gates restored off).
- BTC quote: alpaca (crypto gate on, real price/bid/ask populated).
- EUR/USD quote: twelve_data throughout - no Alpaca mapping, gates
  irrelevant to it, exactly as expected.
- Mixed batch (MSFT,NVDA,ETH,EUR/USD): items correctly split
  alpaca/alpaca/alpaca/twelve_data; envelope-level `source: null` -
  truthfully reflects the mixed-provider batch (prior pass's own fix,
  live-confirmed working).
- Request-storm check: exactly 3 real Alpaca HTTP calls for the 3
  uncached Alpaca-preferred symbols (1 crypto snapshot for ETH + 2
  sequential stock snapshots for MSFT/NVDA, no stock batch API exists to
  consolidate further) - no duplication.
- Preferred-provider-failure -> Twelve Data fallback: not exercised live
  (would need deliberately revoking working production credentials -
  out of proportion for this pass) - covered by the existing
  comprehensive unit-test suite instead, all still passing.
RESTORATION CONFIRMED: secondaryEnabled/hybridRoutingEnabled/
hybridCryptoRoutingEnabled all verified false again via the admin API
response, plus a final live health+AAPL-quote check matching the
original safe-OFF baseline exactly.

FLUTTER CREDENTIAL SAFETY: grep -rn "ALPACA_API_KEY|ALPACA_API_SECRET|
APCA-API-KEY|APCA-API-SECRET" lib/ -> zero matches. No Flutter files
touched this pass at all.

STREAMING BOUNDARY: not touched. MarketStreamRoom remains
Twelve-Data-only. No REST Alpaca response ever mislabeled as a live
Alpaca WebSocket stream.

LICENSING/DISPLAY-RIGHTS GATE: unchanged, unresolved by design - a
clean 9/9 real capability test result still never justifies enabling
public Alpaca routing. Remains a separate operator/product decision.

REGRESSION:
- Backend: 610/610 passing (48 test files, +4 new alpacaBarsStart tests,
  3 existing test files updated to match the corrected, verified-working
  request shape - feed=iex, start=, SOL/XRP - no assertion weakened,
  only updated to match reality). npm run typecheck: clean.
- Flutter: 369/369 passing, unchanged (no Flutter files touched).
  flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release
  (54.3MB): both succeed.
- Security scan: git diff grepped for credential patterns - zero real
  secret values, only env-var NAMES/header NAMES and fake test
  placeholders. git status confirms all 6 changed files are within
  D:\FlutterProjects\mkr\backend only - auc/backend untouched.

PRODUCTION FLAGS: HYBRID_ROUTING_ENABLED, HYBRID_CRYPTO_ROUTING_ENABLED,
MARKET_SECONDARY_ENABLED all confirmed "false" as of the end of this
pass - verified via direct API read after restoration. The controlled
test window was brief, explicitly user-confirmed in advance, fully
reverted before continuing.

REMAINING OPERATOR ACTIONS:
1. Licensing/display-rights review - the one remaining gate before any
   real production activation decision.
2. No further secret provisioning needed - both Alpaca secrets confirmed
   present and working end-to-end.
3. The two prior-pass Closed Testing blockers (release keystore, real
   Play Billing) are unrelated to Alpaca and remain as previously
   reported - unchanged by this pass.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT/Mac
review, and for the operator's licensing/display-rights decision before
any production hybrid activation.
