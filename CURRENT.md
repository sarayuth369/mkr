PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-19 MKR Monetization Correction + Release 3 One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_MONETIZATION_RELEASE3_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 31a5f3f
VERSION: 1.0.1+2 -> 1.0.2+3 (versionCode 3)

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_MONETIZATION_RELEASE3_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Closed Testing Launch Crash / Release 2 One-Pass, completed, was
WAITING_FOR_GPT_REVIEW (commit 969392a, docs commit 0a88919).

THIS PASS SUMMARY - three reported issues, all fixed:

1. AI Pro purchase mapped to the wrong billing plan - ROOT CAUSE:
   PlayBillingRepository trusted Play's own basePlanId string was
   literally 'monthly'/'yearly', but that ID is an arbitrary string the
   operator chooses in Play Console - never guaranteed to match. FIX:
   resolve each catalog product's real offer by exact basePlanId match
   first, then fall back to the offer's own AUTHORITATIVE recurring
   billing period (ISO-8601 P1M/P1Y from the last pricing phase) -
   correct regardless of how the base plan was actually named. A product
   with no matching offer is never silently substituted (purchase()
   throws instead). 6 new tests using realistic flattened
   GooglePlayProductDetails (matching the real Android platform's own
   conversion) prove AI Pro/Pro/Lifetime resolve correctly and wrong-tier
   cross-mapping is rejected. Confirmed live on-device: AI Pro + Yearly
   selects $59.99/year (mkr_premium_ai), never Pro or the monthly offer.

2. AdMob real ads for Release 3 - no code change needed; AdConfig.testMode
   was already a build-time dart-define switch. Built with
   --dart-define=MKR_ADS_TEST_MODE=false. VERIFIED via compiled-binary
   inspection (grepped libapp.so): real ad unit IDs present, Google's test
   ad unit ID strings entirely absent (tree-shaken away). On-device
   (emulator only, see caveat below) ads still rendered with a "Test Ad"
   label - attributed honestly to Google's own documented emulator/new-
   account ad-serving behavior, NOT a code defect, since the binary proof
   is decisive that the app requests real inventory. Flagged for the
   operator to re-confirm on real hardware.

3. Free users could use AI Ask / AI Assistant - ROOT CAUSE: a dead
   entitlement flag (Entitlement.hasUnlimitedAI, "AI Pro is the only tier
   with unlimited AI") existed but was never wired up anywhere. FIX:
   AiAskController.send() (the sole call site of MarketAIService.ask() in
   the app) now refuses to fire unless hasUnlimitedAI is true (AI Pro
   only, per the already-documented spec - Pro has zero AI features
   listed, Lifetime explicitly excludes unlimited AI - broadening to any
   paid tier would have silently expanded the design). AiAskScreen wraps
   its body in the existing PremiumGate widget so a locked user sees a
   clear "AI Market Assistant is a premium feature" + Upgrade prompt and
   never reaches the input field - confirmed live on-device. Enforced at
   the controller (application boundary), not just the UI.

ADDITIONAL MATERIAL FIX FOUND IN AUDIT: Privacy Policy's Advertising
section previously implied only test ads during "development and
testing" without stating published releases now request real inventory -
updated to be honest about Release 3's real-ads state
(backend/src/pages/privacy-page.ts) and DEPLOYED LIVE to mkr-backend
(Version e061c287-c188-471d-bc83-2d395229b567), verified via curl against
https://mkr-backend.biz2success.workers.dev/privacy - live before Release
3 (real ads) reaches testers, not left stale.

REGRESSION:
- flutter analyze: no issues found.
- flutter test: 393/393 passing (+9 net new tests).
- Backend (privacy-page.ts touched): 640/640 tests passing, typecheck
  clean.
- flutter build apk/appbundle --release --dart-define=MKR_ADS_TEST_MODE=false:
  both succeed (APK 58.7MB, AAB 59.6MB). Only ONE coherent Release 3
  artifact built, as required.
- Signing: real upload keystore confirmed (same fingerprint as prior
  releases) - CN=Sarayuth Lorsrichandr, OU=BKKNEX; SHA-256
  9354da41f22d6682dd383507a9f7cc60ade2b457043a561367c5a6307d16f4c8.
- Security scan: git diff grepped for credential patterns - zero real
  matches. Only 8 intended files changed. auc/backend confirmed untouched.
  HYBRID_ROUTING_ENABLED=false and HYBRID_CRYPTO_ROUTING_ENABLED=false
  re-confirmed directly from backend/wrangler.toml (not redeployed this
  pass).
- Real-device verification: no physical Android device connected to this
  session (same limitation as the prior crash-fix pass) - verified on a
  local Android 14 (API 34) Pixel 5 emulator instead. App launched
  reliably, zero fatal exceptions across the full session. Home/Markets/
  Settings/Premium/AI Ask all manually exercised via adb + screenshots.
  No real purchase was completed.

FINAL ARTIFACTS:
- APK: D:\FlutterProjects\mkr\build\app\outputs\flutter-apk\app-release.apk (58.7MB)
- AAB: D:\FlutterProjects\mkr\build\app\outputs\bundle\release\app-release.aab (59.6MB)
- versionCode 3 / versionName 1.0.2 confirmed via aapt dump badging.

REMAINING OPERATOR ACTIONS:
1. Play Console -> Testing -> Closed testing -> Create new release ->
   upload the new AAB above (versionCode 3).
2. Re-verify real ad serving on a PHYSICAL device (not an emulator) -
   this pass's app-side fix is verified correct at the compiled-binary
   level, but Google's own emulator-detection heuristics prevented a
   fully conclusive on-screen confirmation in this environment. Also
   check the AdMob console for any "Limited ad serving" notice (common
   for newly-live apps/accounts).
3. AdMob app-ads.txt crawler confirmation (from an earlier pass) remains
   independently pending on Google's side.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. The one honestly-
flagged limitation (AdMob real-hardware confirmation) is documented as a
remaining operator action, not treated as a blocker requiring further
automated iteration. Waiting for GPT review.
