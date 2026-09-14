PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: Firebase FCM Final Correction Task
TITLE: Fix registration race, external session-loss cleanup, remove debug
       key-prefix log
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_FIREBASE_FCM_FINAL_CORRECTION_REPORT.md

FULL REPORT:
D:\FlutterProjects\gpt-claude\MKR_FIREBASE_FCM_FINAL_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
Firebase FCM Correction Task - completed, was WAITING_FOR_GPT_REVIEW. Mac
reviewed the actual code: architecture + prior corrections PASS, found 3
more production correctness/security cleanup findings, issued as this
final correction task.

THIS PASS:
- Fixed Finding 1 (registration race): AuthController's in-flight device
  registration (initialize() -> requestPermission() -> getToken() ->
  registerDevice(), all real async work) could still write to Supabase
  after the session that started it had already logged out or changed to
  a different user. Fixed with a _sessionEpoch counter, bumped before
  every identity-changing _profile reassignment (login/register/logout/
  external session change or loss), checked (epoch + value-equality
  profile check) immediately before the write - a stale attempt is
  silently abandoned.
- Fixed Finding 2 (external session-loss cleanup): an authenticated
  session lost externally (revoked/expired token, via authStateChanges
  without logout()) fell back to guest but never deactivated the device
  row or revoked the transport token, unlike explicit logout(). Fixed by
  sharing logout()'s cleanup logic (_cleanupDevice(), best-effort, never
  throws) with this path, gated on "was actually authenticated" and
  preceded by the same epoch invalidation so a stale registration can't
  race the cleanup and re-register afterward.
- Fixed Finding 3: removed _debugPrintSupabaseConfig() (main.dart), its
  call site, and the "TEMPORARY diagnostic" comment - it logged a
  Supabase host/key-length/key-prefix, no production purpose.
- Tests: flutter test 155/155 passing (was 149, +6 new). flutter analyze:
  0 issues. flutter build apk --debug: succeeds.
- Every new test verified via revert - 5 of 6 fail against the pre-fix
  code with the exact expected symptom (the 6th, guest-safety, correctly
  passes either way, was never broken). Verification itself caught and
  fixed a real bug in the test harness's own delay-completer bookkeeping -
  reported transparently in the full report.
- No Android/Gradle files, google-services.json, pubspec, or backend
  files touched - exactly the three findings.
- Committed (030da14) and pushed to origin/main. Working tree clean.

UNCHANGED FROM PRIOR REPORTS (not re-verified, no live-device changes this pass):
- Backend FCM secrets (FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)
  remain unconfigured in production.
- Real end-to-end token delivery still requires a physical device or a
  Play-Store-enabled AVD to verify.

NEXT:
Claude has completed the Firebase FCM Final Correction Task and stopped,
per its own instruction. Waiting for GPT/M review. No further task started.
