PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-17/18 MKR AdMob + Google Play Billing One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_ADMOB_BILLING_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: (recorded in the follow-up docs commit on this same pass - see git log)
BACKEND DEPLOY: mkr-backend Cloudflare Worker, Version 83d1afc6-8646-479b-8758-33950306bfc7
(adds POST /api/mkr/billing/verify-purchase, updates hosted privacy policy
Advertising/Payments sections to match the real integration).

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_ADMOB_BILLING_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Hosted Privacy Policy One-Pass, completed, was WAITING_FOR_GPT_REVIEW
(commit 49225d5).

THIS PASS SUMMARY: replaced mock AdMob/Play Billing with real
google_mobile_ads + in_app_purchase integrations, wired into the existing
entitlement/paywall/ad-slot architecture with no unrelated redesign.

REAL BUSINESS-MODEL CONFLICT FOUND AND RESOLVED WITH OPERATOR: the task's
own suggested product IDs (mkr_premium + mkr_premium_lifetime, "exactly
Monthly/Yearly/Lifetime") assumed a single-tier model, but MKR's live UI
already has a real 2-tier model (Pro + AI Pro, different prices). Asked
the operator directly rather than guess - explicit decision: keep the
2-tier model, use 3 real Play product IDs (mkr_premium, mkr_premium_ai,
mkr_premium_lifetime), documented in code why this deviates from the
task's literal suggestion.

REAL ADMOB CONFIG WIRED (provided directly by the operator mid-pass):
App ID ca-app-pub-1918372113970166~1172227772, Banner ad unit
ca-app-pub-1918372113970166/4629836064, App Open ad unit
ca-app-pub-1918372113970166/7862951171 - all now the production defaults,
but AdConfig.testMode (default true) forces Google's own test ad unit IDs
regardless until an operator explicitly builds with
--dart-define=MKR_ADS_TEST_MODE=false for the real release.

GOOGLE PLAY BILLING: real purchase-stream handling, duplicate-event
protection, acknowledge/complete, and a genuine restore-as-source-of-truth
reconciliation that DOWNGRADES a locally-cached tier if Play no longer
confirms it active (never grants Premium from a local flag alone) - all
regression-tested against a fake InAppPurchasePlatform, no real Play Store
connection needed. Server-side purchase verification is a clean,
documented abstraction (PurchaseVerifier / POST /api/mkr/billing/
verify-purchase) that honestly reports "not configured" rather than
fabricating a check - no Google Play Developer API service account exists
yet.

REAL TEST-INFRASTRUCTURE BUG FOUND AND FIXED: Flutter's test binding
defaults defaultTargetPlatform to android regardless of host OS, so the
initial platform-gated real/mock selection would have constructed the
REAL ad/billing services (real platform-channel calls, no native
responder) for every widget test, hanging all of them. Fixed with
explicit adService/billingRepository test-override params on MkrApp,
mirroring the existing marketService override seam.

REGRESSION:
- Backend: 630/630 tests passing (51 test files, +2 new). npm run
  typecheck: clean.
- Flutter: 384/384 tests passing (+10 new). flutter analyze: no issues
  found.
- flutter build apk --release (58.7MB) and flutter build appbundle
  --release (59.6MB): BOTH SUCCEED with the real AdMob + Play Billing SDKs
  compiled in - this is the final AAB, ready for Closed Testing pending
  operator console setup (see below) and the pre-existing release-keystore
  blocker.
- Security scan: git diff grepped for credential patterns across the full
  diff - zero real secret values (App/ad-unit IDs are not credentials per
  Google's own integration requirements, doc-comment prose only).
  auc/backend confirmed untouched. Alpaca/hybrid flags re-verified false
  live after deploy - no market-provider architecture file touched.

REMAINING OPERATOR ACTIONS (none are engineering blockers):
1. AdMob console: confirm App ID/ad units are active; configure the UMP
   EU/UK consent message content (code already fetches/shows whatever is
   configured there); flip --dart-define=MKR_ADS_TEST_MODE=false for the
   real release build when ready for live ads.
2. Play Console: create subscription mkr_premium (base plans monthly,
   yearly), subscription mkr_premium_ai (base plans monthly, yearly), and
   non-consumable mkr_premium_lifetime, with real prices.
3. Play Console: set up Closed Testing license testers so purchases can
   be tested without real charges.
4. Optional: provision a Google Play Developer API service account
   (stored as a Worker secret) to activate real server-side purchase
   verification via the already-deployed, already-documented hook point.
5. Real Android release upload keystore (android/key.properties) -
   unchanged, pre-existing, unrelated to this task.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT review.
