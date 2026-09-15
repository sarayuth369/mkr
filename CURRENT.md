PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: Firebase FCM Task 5 - Final Verification Correction
TITLE: Verify FirebaseMessagingPushService.initialize() wiring directly (not just TwoPhaseInitGuard in isolation)
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_FIREBASE_FCM_INIT_INTEGRATION_TEST_REPORT.md

FULL REPORT:
D:\FlutterProjects\gpt-claude\MKR_FIREBASE_FCM_INIT_INTEGRATION_TEST_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
Firebase FCM Initialization Failure-State Fix - completed, was
WAITING_FOR_GPT_REVIEW (commit 8e9f70a). Mac reviewed: TwoPhaseInitGuard's
own design ACCEPTED as-is (phase1-once, phase2-retries, shared in-flight
Future, no duplicate listeners through retry) - no redesign requested.
Found one remaining verification gap: the new tests exercised
TwoPhaseInitGuard directly with fake phase1/phase2 callbacks, but nothing
proved FirebaseMessagingPushService.initialize() actually wires phase1/
phase2 to the real Firebase entry points (onMessage/onMessageOpenedApp/
getInitialMessage) correctly.

THIS PASS (TEST-ONLY - zero production code changed):
- TwoPhaseInitGuard and FirebaseMessagingPushService.initialize() left
  completely untouched, exactly as instructed - confirmed via `git diff`
  on the source file showing zero bytes changed from commit 8e9f70a.
- Added a new `FirebaseMessagingPushService.initialize() integration`
  test group exercising the REAL initialize() against REAL
  FirebaseMessaging/FirebaseMessagingPlatform types (not a hand-rolled
  substitute):
  - getInitialMessage(): used the EXISTING `messaging:` constructor
    parameter (no new production seam) with a real FirebaseMessaging
    instance backed by a small fake FirebaseMessagingPlatform (overrides
    only delegateFor/setInitialValues/getInitialMessage; every other
    member keeps the SDK's own default throw-UnimplementedError body).
  - onMessage/onMessageOpenedApp: discovered these are the SDK's own
    PUBLIC, STATIC broadcast StreamControllers
    (FirebaseMessagingPlatform.onMessage/.onMessageOpenedApp) - directly
    testable by adding fake RemoteMessages to them, with NO platform
    channel, NO FirebaseApp, NO device required for this half at all.
  - Firebase.app()/FirebaseMessaging.instance itself needed a fake
    FirebasePlatform too (Firebase.delegatePackingProperty is an
    `@visibleForTesting` static the SDK exposes for exactly this).
- 4 new tests (A success - getInitialMessage invoked, converted through
  toPushMessage, delivered via onNotificationTap exactly once, AND the
  real static streams confirmed subscribed; B repeated initialize() after
  success does not re-call getInitialMessage or duplicate onMessage
  delivery; C a getInitialMessage failure propagates then a retry
  succeeds without duplicating listeners; D two concurrent initialize()
  calls share one attempt, getInitialMessage called exactly once).
- Verified these tests catch a REAL regression, not just the abstract
  TwoPhaseInitGuard tests: temporarily reintroduced the original
  duplicate-listener bug pattern (re-running both phases on every call,
  no permanent phase1 guard) directly in TwoPhaseInitGuard and re-ran the
  suite - the new integration test C failed (2 foreground/tap deliveries
  instead of 1) alongside the existing abstract TwoPhaseInitGuard C/D
  tests. Reverted immediately; final state re-verified clean.
- What remains unverified at the FirebaseMessagingPushService level
  (unchanged from before this pass, NOT a new gap): requestPermission(),
  getToken(), unregisterDevice()/deleteToken(), onTokenRefresh(). These
  are byte-identical in the diff (never touched by any pass in this
  thread) and building NotificationSettings/permission-flow fakes to
  cover them was judged out of scope for this specific initialize()
  wiring gap - deliberately not done, to avoid the speculative scope
  expansion this task explicitly forbade.
- Tests: flutter test 168 -> 172 passing (+4). Focused file: 12/12 (8
  pre-existing + 4 new). flutter analyze: 0 issues. flutter build apk
  --debug: succeeds.
- Security scan: one grep match, `apiKey: 'fake-api-key'` - our own
  placeholder constant for the fake FirebaseOptions used to construct the
  test's fake FirebaseApp, not a real credential (confirmed a false
  positive from the api[_-]?key pattern, not suppressed).
- No Android/Gradle files, google-services.json, or pubspec touched -
  test-file-only diff (242 insertions, 0 production lines changed).
  firebase_core_platform_interface/firebase_messaging_platform_interface
  (transitive deps already resolved via firebase_core/firebase_messaging)
  used directly in the test file with a scoped
  `// ignore_for_file: depend_on_referenced_packages`, specifically so
  pubspec.yaml/pubspec.lock stay untouched rather than adding them as
  formal dev_dependencies.
- Committed (f7f2be0) and pushed to origin/main. Working tree clean.

UNCHANGED FROM PRIOR REPORTS (not re-verified, no live-device changes this pass):
- Backend FCM secrets (FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)
  remain unconfigured in production.
- Real end-to-end token delivery still requires a physical device or a
  Play-Store-enabled AVD to verify.

REMAINING KNOWN LIMITATION (verification scope, not a defect):
- Genuine native platform-channel dispatch (a real Android/iOS FCM SDK
  actually delivering a message) is not reachable from `flutter test` -
  the static broadcast streams this pass tests against are the exact
  boundary where the plugin's generated platform-channel code hands
  messages to Dart, so this is the correct and complete unit-test
  boundary; anything upstream of it needs a physical device/emulator.
- requestPermission/getToken/unregisterDevice/onTokenRefresh remain
  verified only by unchanged-diff + full-suite-green, not by a direct
  FirebaseMessagingPushService-level test - pre-existing gap, not
  introduced or worsened by this pass.

NEXT:
Claude has completed this verification-only correction and stopped, per
its own instruction. Waiting for GPT/M review. No further task started.
