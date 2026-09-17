PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-17 MKR Catalog + UI Expansion One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_CATALOG_UI_EXPANSION_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 890bedb
BACKEND DEPLOY: mkr-backend Cloudflare Worker, Version f4475edb-72b6-4e94-b3eb-0c41f800250e
(adds catalog-discovery reference/verify admin routes, admin symbols bulk-update route,
filtered admin symbols GET). All D1 catalog mutations this pass were made live via the
deployed admin API - no separate D1 migration deploy needed.

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_CATALOG_UI_EXPANSION_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Alpaca Credential E2E Test One-Pass, completed, was WAITING_FOR_GPT_REVIEW
(commit ea0d55a).

THIS PASS SUMMARY: Audited catalog/provider/UI tracks in parallel, then expanded
the market catalog using real, live-verified Twelve Data + Alpaca coverage.
Final live state: 32 enabled symbols (up from ~18 after also disabling 10
confirmed-dead legacy rows: SPX/NDX/DJI/RUT/VIX/DXY/US10Y/OIL/SET/SET50 - all
verified dead via real API calls, not assumption). Net new enabled this pass: 9
crypto (DOGE/LTC/BCH/AVAX/LINK/UNI/AAVE/SHIB/DOT) + 5 forex (NZD/USD, EUR/GBP,
EUR/JPY, GBP/JPY, EUR/CHF), all genuinely verified on Twelve Data. Thailand
(XBKK) investigated for real via a new reference-lookup endpoint - confirmed
plan-gated on the current Twelve Data account, honestly excluded rather than
faked.

MATERIAL FINDING THIS PASS: discovered live that `secondaryEnabled=false`
(the correct, documented-safe production state) makes an Alpaca-ONLY-mapped
symbol completely unreachable, not merely lower-priority - a symbol with no
Twelve Data mapping has zero usable route slots when `secondaryEnabled` is
off. This meant the originally-planned 52 new US stocks/ETFs (verified real
via Alpaca, but with no Twelve Data mapping) would have become fresh dead
symbols in production. Consulted the operator directly; the operator's
explicit decision was to keep these 52 symbols disabled/standby (D1 mapping
preserved, ready for instant bulk-enable) rather than enable
`secondaryEnabled`. This was implemented exactly as instructed. Full
root-cause detail and the crypto-mapping self-correction this same
investigation also caught (an initially fabricated Twelve Data mapping
pattern-matched from BTC/USD's format, corrected before anything was left
enabled) are in the report, Section 6.

ALSO FOUND AND CORRECTED MID-PASS: `secondaryEnabled`/`hybridRoutingEnabled`/
`hybridCryptoRoutingEnabled` were found live `true` at the start of this
pass's smoke testing, contradicting the immediately-prior turn's own
documented restoration to `false`. Restored to `false` immediately;
root cause undetermined (no admin route currently exposes audit-log reads -
flagged as an operator action item below).

REGRESSION:
- Backend: 610/610 tests passing (48 test files). npm run typecheck: clean.
- Flutter: 369/369 tests passing. flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release (54.3MB):
  both succeed. Pre-existing debug-signing warning only (no key.properties -
  already a known, previously-reported Closed Testing blocker, unchanged).
- Security scan: git diff grepped for credential patterns - zero real secret
  values found, only env-var/header names and existing redaction logic.
  auc/backend confirmed untouched.

PRODUCTION FLAGS: secondaryEnabled, hybridRoutingEnabled,
hybridCryptoRoutingEnabled all confirmed "false" as of the end of this pass -
verified via a direct config read as the final step before writing this
report.

REMAINING OPERATOR ACTIONS:
1. Enable the 52 verified-standby US stocks/ETFs (JPM, V, MA, ... BND - full
   list in the report Section 4) whenever `secondaryEnabled=true` is
   approved as a production/licensing decision - only a bulk-enable API call
   is needed at that point, no further verification work.
2. Add a GET route for the existing (currently unused) `listAuditLog`
   function so future flag-state drift like this pass's finding can be
   traced to its source.
3. Thailand/Indices/global-commodity-index coverage remains genuinely
   unavailable on the current Twelve Data plan - a plan-upgrade decision,
   not a code fix (see report Section 5).
4. AI asset-insight endpoint returned a generic "no data" summary for
   symbols with real live quotes (XAU/USD, NVDA) during this pass's smoke
   test - pre-existing, unrelated to this pass, worth a separate look.
5. The Flutter UI professionalization pass (task Section 8) was only
   partially addressed this pass (category chip cleanup, pagination, search
   cap) - a deeper visual-hierarchy/typography pass was deferred in favor of
   the correctness work above. Good candidate for a follow-up pass.
6. The two prior-pass Closed Testing blockers (release keystore, real Play
   Billing) are unchanged, unrelated to this pass.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT review,
and for the operator's decision on secondaryEnabled activation before the 52
standby symbols can go live.
