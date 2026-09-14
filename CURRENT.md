PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: Firebase FCM Final Cleanup
TITLE: Make _cleanupDevice()'s deactivate/unregister operations independent
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_FIREBASE_FCM_FINAL_CLEANUP_REPORT.md

FULL REPORT:
D:\FlutterProjects\gpt-claude\MKR_FIREBASE_FCM_FINAL_CLEANUP_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
Firebase FCM Final Correction Task - completed, was WAITING_FOR_GPT_REVIEW.
Mac reviewed the actual code: Findings 1-3 from that task PASS, overall
Firebase FCM architecture PASS. Found 1 additional production correctness
issue in the cleanup path, issued as this final cleanup task.

THIS PASS:
- Fixed: AuthController._cleanupDevice() wrapped deactivateDevice()
  (Supabase) and unregisterDevice() (FCM token revocation) in a single
  shared try/catch - a deactivateDevice() failure skipped
  unregisterDevice() entirely, meaning a Supabase outage during cleanup
  could leave a signed-out FCM token un-revoked.
- Rewrote _cleanupDevice() with three independent try/catch blocks
  (getToken, deactivateDevice, unregisterDevice) - a failure in any one
  never prevents the others from being attempted. unregisterDevice() is
  now unconditionally attempted regardless of whether a token was even
  obtained (it takes no token argument).
- Analyzed concurrency/idempotency (logout() + external session-loss
  firing close together) and documented (no code change needed) why it's
  already safe: the session-epoch mechanism from the prior correction
  pass prevents stale re-registration on any cleanup-triggering path, and
  every cleanup operation is now independently safe to repeat. No lock/
  queue/dependency added.
- Tests: flutter test 160/160 passing (was 155, +5 new). flutter analyze:
  0 issues. flutter build apk --debug: succeeds.
- 4 of 5 new tests verified via revert to fail against the pre-fix
  shared-try/catch code with the exact expected symptom; the 5th
  correctly passes either way (that specific behavior was never broken).
- No Android/Gradle files, google-services.json, pubspec, or backend
  files touched - exactly the one finding.
- Committed (e30700c) and pushed to origin/main. Working tree clean.

UNCHANGED FROM PRIOR REPORTS (not re-verified, no live-device changes this pass):
- Backend FCM secrets (FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)
  remain unconfigured in production.
- Real end-to-end token delivery still requires a physical device or a
  Play-Store-enabled AVD to verify.

NEXT:
Claude has completed the Firebase FCM Final Cleanup task and stopped, per
its own instruction. Waiting for GPT/M review. No further task started.
