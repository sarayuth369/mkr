PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-18 MKR app-ads.txt + Developer Website One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_APP_ADS_TXT_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 54c384c
BACKEND DEPLOY: mkr-backend Cloudflare Worker, Version 9d6ba260-108a-460c-8d5c-dd6cb48f6f66
(adds GET /app-ads.txt and GET / (Developer Website) on the same existing
Worker origin - no new hosting, no new domain).

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_APP_ADS_TXT_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR AdMob + Google Play Billing One-Pass, completed, was
WAITING_FOR_GPT_REVIEW (commit 6129407, docs commit 435c3e0).

THIS PASS SUMMARY:
- Developer Website: https://mkr-backend.biz2success.workers.dev
- app-ads.txt: https://mkr-backend.biz2success.workers.dev/app-ads.txt
- Authorized-seller line served verbatim, exactly as given by the operator's
  own AdMob console, no invented additions:
  google.com, pub-1918372113970166, DIRECT, f08c47fec0942fa0
- Root `/` previously fell through to this Worker's JSON 404 handler - it is
  now a small public landing page reusing already-approved in-app "About"
  copy, linking to the existing /privacy page, kept fully separate from the
  Admin Web deployment (mkr-admin.pages.dev, untouched, never linked).
- AdMob publisher ID (pub-1918372113970166) confirmed by direct string
  comparison to match the AdMob App ID already wired into
  AndroidManifest.xml (ca-app-pub-1918372113970166~1172227772) - same
  account, no AdMob/Billing code changed.
- /privacy unchanged (no concrete consistency issue found).

REGRESSION:
- Backend: 640/640 tests passing (53 test files, +2 new). npm run
  typecheck: clean.
- Live public verification performed post-deploy (curl + browser pane):
  /app-ads.txt -> HTTP 200, text/plain, exact seller line, no
  redirect/auth/JSON wrapper. / -> HTTP 200, text/html, no
  redirect/auth, contact-email canvas confirmed actually drawing pixels
  (not dead code). /privacy -> HTTP 200 regression-checked, unchanged.
- Security scan: diff + new files grepped for credential patterns - zero
  real matches. auc/backend confirmed untouched (outside this repo).
  Alpaca/hybrid flags reconfirmed false live post-deploy
  (HYBRID_ROUTING_ENABLED=false, HYBRID_CRYPTO_ROUTING_ENABLED=false).

REMAINING OPERATOR ACTION (not an engineering blocker):
1. Play Console -> App content / Store settings -> Developer website field
   -> set to https://mkr-backend.biz2success.workers.dev -> Save.
2. AdMob/Google's own crawler must independently confirm app-ads.txt after
   that URL is set - this is PENDING and cannot be claimed complete from
   the engineering side. Do not treat AdMob verification as done until the
   AdMob console itself shows it confirmed.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT review.
