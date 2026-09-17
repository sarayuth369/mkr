PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-17 MKR Pre-Closed-Testing Final One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_PRE_CLOSED_TESTING_FINAL_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 59a0f07
BACKEND DEPLOY: mkr-backend Cloudflare Worker, Version bae7a92a-882a-472e-b489-d220c56f06f0
(fixes a real admin-audit gap: secondaryProvider-only changes previously
wrote zero audit rows).

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_PRE_CLOSED_TESTING_FINAL_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Final UX + Market Reliability + Catalog Polish One-Pass, completed,
was WAITING_FOR_GPT_REVIEW (commit e2e17d9).

THIS PASS SUMMARY: primarily a re-verification/audit-depth pass, not a
rebuild - the two prior passes already fixed the material Home/Markets
reliability, AI Asset-Insight, and admin-auditability bugs. This pass:

1. Re-tested Home/Markets reliability live (5/5 quote calls succeeded,
   circuit closed) - confirmed the prior pass's two fixes hold.
2. Re-assessed the circuit breaker's per-isolate tradeoff per this task's
   explicit instruction - decided NOT to redesign it (no new concrete
   regression found beyond what's already fixed; a real fix would need new
   Durable-Object infrastructure, explicitly out of bounds without proof).
3. Re-confirmed catalog integrity live: 32 enabled / 52 standby / 10 dead,
   zero drift since the prior pass, hybrid flags still false.
4. Found and fixed a REAL admin-audit gap: handleAdminProvidersUpdate
   could change secondaryProvider alone with zero audit entry written.
   Fixed and regression-tested.
5. Found (but deliberately did not "fix" in code) a real structural gap:
   hybridRoutingEnabled/hybridCryptoRoutingEnabled/secondaryEnabled all
   fall back to wrangler.toml env vars when unset in KV - a redeploy that
   changes those env vars bypasses the audit log entirely. This is very
   plausibly the real explanation for the EARLIER (already-resolved) flag-
   drift incident. Not removed, since the env fallback is a legitimate
   operator control surface - documented as an operator-process
   recommendation instead (treat wrangler.toml changes to these 3 vars
   with the same scrutiny as an admin-API flag flip).
6. Live-tested AI Asset-Insight/Brief for XAU/USD, NVDA, AND a crypto
   symbol (BTC) plus a disabled symbol (SPX) as a negative control - all
   correct: real data for enabled symbols, an honest "no data" statement
   for a genuinely unavailable one, no fabrication anywhere.
7. Fixed one UI consistency item: AIInsightCard's icon now uses the
   dedicated aiAccent theme token (was theme.colorScheme.primary),
   matching the AI-branding treatment already used elsewhere.
8. Investigated a broad "raw exception leak" concern the audit initially
   raised across ~20 call sites - on inspection this was overstated: the
   app's domain exceptions (MarketFetchException/MarketCatalogException/
   MarketAIException) are all deliberately designed with a clean
   toString() => message by architecture, confirmed via their own
   definitions and doc comments. Judged a mass rewrite unwarranted given
   the low actual residual risk versus regression risk under time
   pressure - documented as a smaller follow-up if a real leak is ever
   observed live, not done speculatively here.
9. Found (not fixed) that the Android release build type sets neither
   minifyEnabled nor shrinkResources - a real pre-Play-Store gap, but
   flipping it blind without real-device runtime verification of the
   obfuscated build was judged too risky to do in this environment.
   Flagged as an operator/follow-up action needing real-device testing.

REGRESSION:
- Backend: 621/621 tests passing (49 test files, +1 new regression test).
  npm run typecheck: clean.
- Flutter: 374/374 tests passing (unchanged - this pass's UI fix needed no
  new test surface). flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release
  (54.3MB): both succeed. Same pre-existing debug-signing warning,
  unchanged.
- Security scan: git diff grepped for credential patterns - zero real
  secret values across the 3 files this pass touched. auc/backend
  confirmed untouched.

PRODUCTION FLAGS: secondaryEnabled, hybridRoutingEnabled,
hybridCryptoRoutingEnabled all confirmed "false" via a live admin
dashboard read as the final verification step.

READINESS: no known blocking ENGINEERING defects for Closed Testing.
Closed Testing itself is blocked strictly by operator prerequisites
(real release keystore, real Play Billing setup, real AdMob account) -
see report Section 13 - none of which Claude can perform.

REMAINING OPERATOR ACTIONS:
1. Generate/safeguard a real Android release upload keystore.
2. Set up Google Play Console + real Play Billing products; build the
   real in_app_purchase + server-side receipt validation integration
   (replaces MockBillingRepository).
3. Create an AdMob account + real ad unit IDs; build the google_mobile_ads
   SDK integration once available.
4. Confirm the Firebase console project is genuinely live/active
   server-side (repo-level config is correct).
5. Treat any future wrangler.toml change to the 3 hybrid/secondary env
   vars with the same scrutiny as an admin-API flag flip - this path
   bypasses the audit log by design.
6. Consider enabling Android release minifyEnabled/shrinkResources before
   real Play Store submission - only with real-device runtime testing of
   the obfuscated build, not a blind flip.
7. Enable the 52 verified-standby US stocks/ETFs whenever a
   secondaryEnabled=true production-activation decision is made.
8. Thailand/Indices/global-commodity-index coverage remains genuinely
   unavailable on the current Twelve Data plan - a plan-upgrade decision.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT review.
