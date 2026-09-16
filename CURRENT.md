PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-16 MKR Post-Phone Closed Testing Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_POST_PHONE_CLOSED_TESTING_CORRECTION_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: e7c6918
BACKEND DEPLOYS: mkr-backend Cloudflare Worker deployed twice this pass -
Version ID 485c4f4f-4d5d-4216-b5e3-3d2b3fbcb9dc (calendar fromInstant/
toInstant support, from the prior pass, unchanged), then
51878475-cf00-4747-bcc1-d8d77c99aee0 (the deeper provider-manager.ts root
cause fix found during this pass's own live verification). MKR's own
isolated Worker only; no other app/account resource affected.

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_POST_PHONE_CLOSED_TESTING_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Closed Testing Readiness pass, completed, was WAITING_FOR_GPT_REVIEW
(commit cb0aadd). Mac's physical-phone test found Home/Markets still
intermittently showing little or no content despite that pass's error-
truthfulness fixes, plus a bottom-ad overlap issue.

THIS PASS - one consolidated correction, focused on the true remaining
root cause: request pressure, not error truthfulness.

ROOT CAUSE (confirmed): HomeController.refresh() and
MarketsController._load() both still called MarketService.getAllQuotes()
- the WHOLE ~20-symbol backend catalog, in one burst, on every load. Twelve
Data Basic's 8-credits/minute cap (per the task's own reference) means a
single 20-symbol request can by itself exceed a full minute's budget -
this, not truthfulness, was the actual mechanism behind "often LIVE but no
content" and "sometimes only EUR/USD."

FIX - request strategy redesign (no getAllQuotes() calls remain in either
controller):
- New MarketService.getCatalog() (metadata only, D1+KV-cache only, ZERO
  provider credit cost) lets a caller know the full symbol universe before
  requesting any quotes.
- Home: derives a small (<=6) set from the catalog's own `featured` flag
  (currently XAU/USD, NVDA, BTC - gold+stock+crypto, preserving product
  intent with symbols already confirmed resolvable), filled by sortOrder
  if needed. ONE getQuotesFor() call covers Pulse (3) + Snapshot (6).
- Markets: catalog-first + controlled/lazy loading. An 8-symbol initial
  page (one full Twelve Data chunk), quotes accumulate persistently across
  category/search changes (nothing already resolved is ever discarded),
  and selecting a category/typing a search fetches ONLY the symbols still
  missing for that filter (capped at 8/action) - a catalog symbol not on
  the initial page is now genuinely discoverable. refresh() re-fetches
  only the current filtered view, not the whole catalog.
- markets_screen.dart needed ZERO changes beyond a padding fix (below) -
  the controller's public state/API shape is unchanged.

DEEPER ROOT CAUSE (backend, found during this pass's own live
verification, distinct from the prior pass's parser fix):
MarketProviderManager.getBatchQuotes (backend/src/providers/
provider-manager.ts) diverged from every other method on the same class
(getQuote/getCandles/getMarketStatus, all via the shared withFailover
helper, whose final fallback ALWAYS throws) - when the primary was
confirmed unhealthy (or its circuit already open) and no secondary was
available, it silently returned every requested symbol mapped to null,
indistinguishable from a genuine provider-confirmed "no data" answer.
With MKR's secondary disabled by default, this was always reachable on a
real primary outage - market-routes.ts then reported affected symbols in
NEITHER items NOR errors, cached as false "no data" for the full TTL.
Live-reproduced this pass (8-symbol batch: 3 items, 0 errors, 5 silently
missing) and confirmed via wrangler tail + code tracing. Fixed to throw
consistently with withFailover's existing contract; the deliberately
different "nothing mapped for either provider" (no coverage at all) case
is preserved as a genuine non-fault. 3 existing tests asserting the old
buggy behavior corrected; 4 new regression tests added.

PRODUCTION SYMBOL CAPABILITY (live-tested individually this pass): 18/20
catalog symbols resolve reliably. SET/SET50 (Thailand) consistently
return HTTP 502 PROVIDER_UNAVAILABLE on isolated single-symbol requests -
genuinely provider-unavailable (Twelve Data doesn't serve them on this
plan), not catalog-unsupported/disabled and not a capacity artifact.
Recommendation (not executed - requires D1/admin access Claude doesn't
hold): disable SET/SET50 in the backend catalog.

CALENDAR: re-verified 7ad26c5's fromInstant/toInstant device-local-day fix
live against the deployed backend - malformed input rejected, Today/This
Week both return correct honest data. No code changes this pass.

AI INTEGRITY: re-confirmed the prior audit still holds (no diff touched
AI selection this pass) - no runtime/mock contamination found, so per the
task's own instruction, AI was not redesigned or otherwise changed.

AD OVERLAP: audited all 5 MkrBottomBannerAd screens - Scaffold layout
composition is structurally correct everywhere (space IS reserved, no
literal render-behind). Found and fixed a real, code-verifiable gap:
Markets' quote list had ZERO bottom padding before the ad slot (every
sibling screen already used 16px) - last row touched the ad's top edge
with no breathing room. Fixed to match siblings. A Flutter web build was
attempted for direct visual confirmation but failed for an unrelated,
pre-existing reason (dart:ffi/win32, out of scope); no Android
emulator was available in this environment either - reported accurately
as code-grounded, not a literal physical-device screenshot.

REGRESSION:
- Flutter: 357/357 passing. home_controller_test.dart and
  markets_controller_test.dart rewritten around the new
  getCatalog()+getQuotesFor() pattern (old hardcoded pulseSymbols/
  snapshotSymbols assertions removed since those lists no longer exist);
  new dedicated regression coverage for catalog-first/lazy loading
  (initial page size, category/search discovering an unloaded symbol,
  retained-on-filter-switch caching, refresh() scoping, per-fetch cap).
  getCatalog() stubs added to 6 other fake MarketService test doubles
  (trivial, unused by those tests). flutter analyze: no issues.
- Backend: 540/540 passing (4 new tests for the deeper fix; 3 existing
  tests across 2 files corrected from asserting the old buggy
  null-for-everyone fall-through to the now-consistent throw). TypeScript
  typecheck clean.
- flutter build apk --debug and flutter build appbundle --release: both
  succeed.
- Security scan: no secrets. Final mock-data grep: MockMarketCatalog
  usage unchanged from the prior-turn baseline (16 pre-existing files,
  none newly using it in real mode).
- git diff reviewed - 16 files (816 insertions, 176 deletions); no Market
  Pool/infra redesign, no paid provider, no Alpaca activation, no
  fabricated market/calendar/AI data; auc/backend untouched.

PRODUCTION:
- mkr-backend Cloudflare Worker deployed this pass for the deeper
  provider-manager.ts fix (see above) - required to live-verify it.
- Live smoke (post-deploy): health OK; Home's new 3-symbol set resolves
  0 errors; Markets' new 8-symbol initial page resolves cleanly after the
  deeper fix (previously reproduced the silent-drop live); full 20-symbol
  catalog: 13 items + 7 honest errors (forex + SET/SET50), 0 silently
  missing; Calendar Today/This Week both correct.

RELEASE READINESS (re-confirmed, no change this pass):
1. A real release keystore still does not exist - Gradle scaffolding
   works (this pass's own release build proves it), android/key.properties
   remains the app owner's own credential to generate/safeguard.
2. A publicly hosted Privacy Policy URL is still required - cannot be
   hosted from this repo.
Neither claimed resolved; a debug-signed release artifact is never
represented as production-ready.

REMAINING DEFERRED RISKS (real, not hand-waved):
1. Twelve Data Basic's 8-credit/minute ceiling is unchanged - this pass
   removes MKR's own self-inflicted bursts (the actual provable cause of
   the reported symptoms), not the provider's own capacity; the system
   now degrades honestly under real heavy load instead of claiming the
   ceiling was raised.
2. SET/SET50 remain catalog-enabled but genuinely provider-unavailable -
   flagged, not disabled (no D1/admin access).
3. The ad-overlap fix is grounded in code-level padding analysis, not a
   literal physical-device screenshot - no real device/emulator was
   available in this environment.
4. Flutter web builds are broken (unrelated, pre-existing dart:ffi/win32
   issue) - noted only because it blocked one verification avenue; not a
   Play Store blocker, out of scope, not touched.

NEXT:
Claude has completed this pass and stopped, per its own instruction. No
further improvement loop started. Waiting for GPT/Mac review.
