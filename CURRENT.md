PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Closed Testing Readiness (task file absent - requirements taken from chat)
TITLE: Fix per requirements given directly in chat (referenced file
GPT_TO_CLAUDE_MKR_CLOSED_TESTING_READINESS_TASK.md did not exist in
D:\FlutterProjects\gpt-claude\ at the start of this turn)
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 7ad26c5
BACKEND DEPLOY: mkr-backend Cloudflare Worker deployed this pass -
Version ID 485c4f4f-4d5d-4216-b5e3-3d2b3fbcb9dc (required to live-smoke-
verify the two backend-side root-cause fixes below; MKR's own isolated
Worker, no other app/account resource affected)

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_CLOSED_TESTING_READINESS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Home/Markets Final User-Visible Audit, completed, was
WAITING_FOR_GPT_REVIEW (commit 5fbdda5).

THIS PASS - consolidated fix across 7 named areas:

1/2. Home/Markets root cause (provider capacity + production catalog):
TwelveDataProvider's multi-symbol /quote endpoint silently omits a symbol
when the account's free-tier capacity is exhausted mid-batch (not an
error - just a missing key), and parseTwelveDataBatchQuotes previously
mapped that identically to an EXPLICIT provider-confirmed no-data answer -
market-routes.ts then cached the capacity artifact as confirmed "no data"
for the full TTL and never reported it as an error. Fixed: an absent key
is now left OUT of the batch result entirely (reusing the existing
"symbol not in result" -> PROVIDER_UNAVAILABLE/never-cached contract
already used for a whole-chunk failure). Live-confirmed on the deployed
backend: Home's exact symbol set (XAU/USD,BTC,SET), which previously
dropped 2 of 3 symbols silently, now correctly reports SET in `errors`.
This IS the quota-safe strategy improvement - a capacity gap now surfaces
immediately and retries naturally instead of being invisible for 60s.

3. Home/Markets partial/unavailable semantics: re-verified already
correct from earlier passes: no changes needed, now fed honest data.

4. Calendar timezone (Today/Tomorrow/This Week) root cause: every
bucketing path (backend /today, /week, and the client's "tomorrow") used
UTC calendar days, never the device's local day - a Bangkok (UTC+7) user
could see "Today" still showing the prior UTC day. Fixed: backend's
/events route gained fromInstant/toInstant (exact UTC instants,
precedence over date/from/to); Flutter now computes device-local
day/week boundaries and sends exact instants for all three ranges.
Live-confirmed: malformed instant rejected (400); real current-week query
against the deployed backend returns correct data.

5. China filter vs real coverage: CalendarController.countries listed
Japan/China/Thailand - no real data source for China/Thailand exists at
all, and "Japan" never matched the real 'JP' code. Fixed: filter now
lists only real coverage (US/EU/UK/JP by code); mock demo data's Japan
event corrected to use the real code too.

6. AI integrity: full audit (service selection, error handling, backend
routes) - confirmed no code path can present mock as live in a real-mode
build. No fix needed; documented as a narrow build/CI-misconfiguration-
only residual risk.

7. Material Closed Testing blockers (full-system audit): 
- CONFIRMED BLOCKER, FIXED (scaffolding only): release builds were
  signed with the DEBUG keystore (instant Play Console rejection). Added
  key.properties-based release signing config (falls back to debug when
  absent - local builds unaffected). A real keystore/key.properties is
  NOT generated here (the app owner's own credential to create/safeguard)
  - android/key.properties.example added as a template.
- CONFIRMED BLOCKER, FIXED (content only): in-app Privacy Notice falsely
  claimed "no account required... data will be processed... before that
  feature is enabled" while Supabase auth/FCM tokens/cloud sync already
  ship today. Corrected in English and Thai. A publicly hosted URL is
  still needed (cannot be hosted from this repo) - real remaining
  limitation.
- GAP, FIXED: no global error handler anywhere in the app - added
  runZonedGuarded/FlutterError.onError/PlatformDispatcher.instance.onError
  in main.dart (logging only, no new crash-reporting SDK added).
- Confirmed fine, no change: applicationId/version, permissions,
  cleartext traffic, app icons, hardcoded secrets/URLs, debug banner.

REGRESSION:
- Backend: 536/536 passing (14 new tests). TypeScript typecheck clean.
- Flutter: 349/349 passing (3 existing calendar-service tests corrected
  to assert the fixed instant-range behavior; no test count regression).
  `flutter analyze`: no issues. `flutter build apk --debug` and
  `flutter build apk --release`: both succeed.
- Security scan against the diff: no secrets (only expected Gradle
  property-name references and legitimate privacy-notice prose).
- git diff reviewed - 21 files (403 insertions, 40 deletions); no Market
  Pool/infra redesign, no paid provider, no UI redesign, no fabricated
  market/calendar/AI data; auc/backend untouched.
- Final mock-data grep: MockMarketCatalog references unchanged from the
  prior-turn baseline (16 files, all pre-existing doc-comment mentions or
  the standalone demo implementation).

PRODUCTION:
- mkr-backend Cloudflare Worker deployed this pass (see above) - required
  for the two backend-side root-cause fixes to be live and
  live-smoke-verifiable. MKR's own isolated Worker only.
- Live smoke: health/symbols OK; the previously-reproduced batch-quote
  silent-drop bug now surfaces honestly as PROVIDER_UNAVAILABLE instead
  of vanishing; calendar fromInstant/toInstant validated (malformed
  rejected, real current-week query returns correct live data).

REMAINING LIMITATIONS (real, not hand-waved):
1. A publicly hosted Privacy Policy URL is still required for Play
   Console submission - the in-app text is now accurate, but hosting it
   externally is the app owner's own action.
2. A real release keystore does not exist yet - Gradle scaffolding is
   ready; android/key.properties + its .jks must be generated and
   safeguarded by the app owner before a submittable release build exists.
3. No crash-reporting/telemetry SDK was added - the new global error
   handlers only guarantee local logging + no isolate crash, not remote
   visibility into production errors. Intentionally left for the app
   owner to decide (new dependency/infra).
4. The Twelve Data Free capacity constraint itself is unchanged - the fix
   makes the degraded state honest, it cannot increase the provider's
   actual free-tier throughput.
5. AI's missing demo-vs-live indicator is a real but narrow gap, reachable
   only via a build/CI misconfiguration, not any runtime code path - not
   fixed this pass since no actual runtime risk was found.

NEXT:
Claude has completed this pass and stopped, per its own instruction. No
further improvement loop started. Waiting for GPT/Mac review.
