PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: Firebase FCM Correction Task (see D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_FIREBASE_FCM_CORRECTION_TASK.md)
TITLE: Fix 3 correctness gaps - restored-session registration, idempotent
       permission request, stale push docs
STATUS: WAITING_FOR_GPT_REVIEW

GPT COMMAND:
D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_FIREBASE_FCM_CORRECTION_TASK.md

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_FIREBASE_FCM_CORRECTION_REPORT.md

FULL REPORT:
D:\FlutterProjects\Docs\report\MKR_FIREBASE_FCM_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
Firebase FCM Integration Task - completed, was WAITING_FOR_GPT_REVIEW.
Mac reviewed the actual code: architecture PASS, 3 correctness gaps found,
issued as this correction task.

THIS PASS:
- Fixed Finding 1: AuthController._restore() now triggers
  _registerDeviceIfPossible() after a real (non-guest) restored session -
  previously a fresh install/reinstall with a still-valid Supabase session
  could mint a new FCM token yet never register it. Guest-safe,
  best-effort, never blocks startup. Verified via revert (new test fails
  against pre-fix code, passes with the fix).
- Fixed Finding 2: FirebaseMessagingPushService.requestPermission() is now
  idempotent using the platform's own live getNotificationSettings() state
  (no invented persistence) - only genuinely-unresolved statuses still
  call the real native request.
- Fixed Finding 3: corrected doc comments in push_notification_service.dart,
  noop_push_notification_service.dart, supabase_device_repository.dart,
  and auth_controller.dart that still claimed Noop was the only shipped
  implementation - narrowly scoped, no broader cleanup.
- Tests: flutter test 149/149 passing (was 147, +2 new). flutter analyze:
  0 issues. flutter build apk --debug: succeeds.
- No Android/Gradle files, google-services.json, pubspec, or backend
  files touched - exactly the three findings.
- Committed (d71f3b7) and pushed to origin/main. Working tree clean.

UNCHANGED FROM PRIOR REPORT (not re-verified, no live-device changes this pass):
- Backend FCM secrets (FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)
  remain unconfigured in production.
- Real end-to-end token delivery still requires a physical device or a
  Play-Store-enabled AVD to verify.

NEXT:
Claude has completed the Firebase FCM Correction Task and stopped, per
its own instruction. Waiting for GPT/M review. No further task started.
