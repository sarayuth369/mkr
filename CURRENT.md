PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-17 MKR Final UX + Market Reliability + Catalog Polish One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FINAL_UX_RELIABILITY_CATALOG_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: (recorded in the follow-up docs commit on this same pass - see git log)
BACKEND DEPLOY: mkr-backend Cloudflare Worker, Version 66072d17-af47-4f66-966c-e70601f2860e
(AI asset-insight active-fetch fix, AI brief symbol-list correction, new admin
audit-log route, admin symbols status/providerCoverage fields). A D1 catalog
correction (nulling 5 stale broken mapping strings so they correctly compute
as "dead" instead of "standby" - see report Section 4) was applied live via
the admin API before this report was finalized.

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FINAL_UX_RELIABILITY_CATALOG_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Catalog + UI Expansion One-Pass, completed, was WAITING_FOR_GPT_REVIEW
(commit ec0305f).

THIS PASS SUMMARY: Audited Home/Markets reliability, AI Asset-Insight,
Admin Symbols/audit-log, and UI polish in parallel, then fixed all material
findings in one integrated pass.

TWO REAL RELIABILITY BUGS FOUND AND FIXED (matching the reported
intermittent "PROVIDER UNAVAILABLE" symptom):
1. MarketProviderManager.ensureConnected() previously cached a FAILED
   connect attempt forever - once the first connection attempt completed
   (success or failure), every later call returned that same already-
   settled future permanently, so a single transient health-check blip at
   cold start stuck the whole app in providerError until backgrounded/
   reopened. Fixed with a bounded 15s cooldown-based retry - self-heals
   without ever hammering healthCheck() per call.
2. MarketsController's "nothing to fetch" early-return path left a stale
   _lastFetchError from a PREVIOUS, unrelated category set, so switching
   back to a category whose symbols were already resolved/unavailable
   could show a different category's stale error message. Fixed by
   clearing the error when nothing was actually fetched this call.
Both regression-tested. Two further real mechanisms (per-isolate circuit
breaker state; cold-cache-with-no-stale-fallback) were confirmed real but
intentionally NOT fixed - documented as accepted platform tradeoffs, not
proven regressions, out of this pass's scope.

AI ASSET-INSIGHT BUG FOUND AND FIXED: root cause confirmed via live
investigation - the route only ever did a passive, read-only cache lookup
under the same key /market/quote writes to, with no active fetch of its
own; a cold/never-warmed cache entry silently produced a hardcoded
"no data" fallback the model then honestly paraphrased. Fixed by giving it
the same active-fetch path /market/quote itself uses. Live-verified fixed
for both XAU/USD and NVDA on the deployed Worker. Also fixed handleAiBrief's
hardcoded 5-symbol grounding list, 3 of which were symbols the prior pass
permanently disabled (DXY/US10Y/OIL) - replaced with currently-enabled
symbols.

ADMIN SYMBOLS / AUDIT-LOG: added GET /admin/audit-log (the listAuditLog
function existed since the first admin route but nothing ever exposed it -
exactly the gap the prior pass hit when it couldn't trace who set hybrid
flags to true). Added computed status (enabled/standby/dead) and
providerCoverage fields to GET /admin/symbols, plus a status filter. This
surfaced a real data-integrity gap: 5 of the 10 legacy dead rows
(SPX/NDX/DJI/RUT/VIX) still carried their old, confirmed-broken Twelve Data
mapping string, making them misreport as "standby" instead of "dead" -
corrected by nulling those mapping columns (in D1 live and in schema.sql).

UI POLISH: fixed a real bug (AI Ask rendered the raw caught exception as a
chat message on failure - now a friendly localized error bubble), Calendar's
freshness dot (hardcoded raw colors -> theme's live/stale/offline tokens),
Market Detail's price-change text and "not found" state (bypassed theme ->
theme.textTheme / shared EmptyState), Portfolio/Alerts hardcoded text
styles -> theme.textTheme, Watchlist/Alerts padding (12 -> 16, matching
every other list screen), Home's Radar empty state (bare text -> muted
icon+caption). Surveyed but deliberately deferred: Watchlist/Portfolio
missing ad slots and live-status indicators, AI accent-color consistency
across screens, one NewsCard cosmetic nitpick - all documented in the
report, not silently dropped.

REGRESSION:
- Backend: 620/620 tests passing (49 test files, +1 new file, +10
  new/updated tests). npm run typecheck: clean.
- Flutter: 374/374 tests passing (+5 new tests). flutter analyze: no
  issues found.
- flutter build apk --debug and flutter build appbundle --release
  (54.3MB): both succeed. Same pre-existing debug-signing warning as every
  prior pass (unchanged, not a regression).
- Security scan: git diff grepped for credential patterns - zero real
  secret values. auc/backend confirmed untouched.

PRODUCTION FLAGS: secondaryEnabled, hybridRoutingEnabled,
hybridCryptoRoutingEnabled all confirmed "false" as of the end of this
pass - verified via a direct config read as the final live-smoke step.
Twelve Data remains primary; Alpaca remains a verified, disabled standby
(52 rows, fully mapped, ready for activation).

REMAINING OPERATOR ACTIONS:
1. Enable the 52 verified-standby US stocks/ETFs whenever a
   secondaryEnabled=true production-activation decision is made (a
   licensing/product decision, not engineering) - mapping is ready, only a
   bulk-enable call is needed.
2. The PRIOR pass's flag-drift root cause (secondaryEnabled/hybrid flags
   found unexpectedly true) remains formally untraced historically - the
   new audit-log route means any FUTURE recurrence can now actually be
   investigated.
3. Thailand/Indices/global-commodity-index coverage remains genuinely
   unavailable on the current Twelve Data plan - a plan-upgrade decision.
4. The circuit breaker's per-isolate state is a real, understood
   contributor to occasional "retry succeeds" behavior - fixing it would
   need a Durable-Object-based redesign, intentionally out of this pass's
   scope. Consider for a future pass if reports persist after this pass's
   two fixes.
5. A handful of lower-priority UI inconsistencies were surveyed but not
   fixed this pass (see report Section 6) - candidates for a future
   UI-focused pass.
6. The two prior-pass Closed Testing blockers (release keystore, real Play
   Billing) are unchanged, unrelated to this pass.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT review.
