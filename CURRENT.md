PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-17 MKR Hosted Privacy Policy / Play Console One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_PRIVACY_POLICY_HOSTED_PAGE_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: (recorded in the follow-up docs commit on this same pass - see git log)
BACKEND DEPLOY: mkr-backend Cloudflare Worker, Version 8b4ad4eb-f582-4ba8-a324-b8f8eeaa9a20
(adds the new GET /privacy public page route).

HOSTED PRIVACY POLICY URL (paste into Google Play Console):
https://mkr-backend.biz2success.workers.dev/privacy

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_PRIVACY_POLICY_HOSTED_PAGE_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Pre-Closed-Testing Final One-Pass, completed, was
WAITING_FOR_GPT_REVIEW (commit 75cdce2).

THIS PASS SUMMARY: created a real, public, no-auth HTTPS Privacy Policy
page for MKR, hosted on the EXISTING mkr-backend Cloudflare Worker (no new
domain/service - inspected the repo first, confirmed no custom domain and
no other web infra besides this Worker and the separate admin panel).
Content was reconciled against pubspec.yaml's actual dependencies and
prior audit findings - states plainly what's real (guest/local storage,
optional Supabase account+sync, FCM push tokens, Twelve Data/Alpaca via
the backend proxy, Cloudflare Workers AI) and honestly states what is NOT
yet real (no ad SDK, no real billing integration) instead of fabricating
either. Effective date included, framed as a practical product notice,
never a legal certification. Contact email is the address the operator
explicitly approved this pass, rendered as a canvas-drawn image at
runtime (assembled from character codes client-side) rather than literal
HTML text, per the operator's explicit request to reduce automated
scraping - confirmed absent from the page's raw source via test.

Flutter's Settings > Privacy Policy now opens this exact hosted URL
externally via url_launcher (promoted from a transitive to a direct
dependency - it was already pulled in by other packages), falling back to
the existing, unchanged, fully localized in-app static notice only if the
launch genuinely fails. Added the required Android 11+ package-visibility
<queries> entry for https VIEW intents so the fallback only ever fires for
devices genuinely missing a browser, not by default.

REGRESSION:
- Backend: 627/627 tests passing (50 test files, +1 new file/+6 tests for
  the privacy route). npm run typecheck: clean.
- Flutter: 376/376 tests passing (+4 new: two Settings/Privacy-Policy
  widget tests using a fake UrlLauncherPlatform, no real platform channel
  touched). flutter analyze: no issues found.
- flutter build apk --debug and flutter build appbundle --release
  (54.4MB): both succeed. Same pre-existing debug-signing warning,
  unrelated to this task, unchanged.
- Live verification: curl confirms HTTP 200, no auth, no redirect to
  login. Loaded in a real browser pane at both desktop and mobile
  (375x812) widths - renders correctly, dark theme consistent with the
  app's own palette, no overflow, contact canvas renders as a real image.
- Security scan: git diff/new-file grep for credential patterns and the
  literal contact email string - zero matches in any committed source.
  git status confirms only the 6 files this task's own scope implies were
  changed, plus the 2 new files - no unrelated changes.
  D:\FlutterProjects\auc\backend not referenced by any change.

REMAINING OPERATOR ACTIONS:
1. Paste https://mkr-backend.biz2success.workers.dev/privacy into Google
   Play Console's Privacy Policy field when ready to submit.
2. All other previously-reported operator prerequisites (release
   keystore, real Play Billing, real AdMob account) are unchanged and
   outside this task's scope - see the Pre-Closed-Testing Final report.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created. Waiting for GPT review.
