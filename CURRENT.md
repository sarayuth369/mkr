PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: Firebase FCM Integration Task (see D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_FIREBASE_FCM_TASK.md)
TITLE: Replace Noop push with real Firebase Cloud Messaging on Android
STATUS: WAITING_FOR_GPT_REVIEW

GPT COMMAND:
D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_FIREBASE_FCM_TASK.md

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_FIREBASE_FCM_REPORT.md

FULL REPORT:
D:\FlutterProjects\Docs\report\MKR_FIREBASE_FCM_INTEGRATION_REPORT.md

NOTE ON THIS FILE:
This exact path (D:\FlutterProjects\mkr\CURRENT.md) did not previously
exist - every prior task in this session's protocol used
D:\FlutterProjects\gpt-claude\CURRENT.md as the single shared state file.
Both are now kept in sync going forward; treat
D:\FlutterProjects\gpt-claude\CURRENT.md as authoritative for the overall
GPT<->Claude mailbox protocol state, this file as a project-local mirror
for this task.

PREVIOUS STATE:
FINAL EDIT TASK 3 (healthSnapshot half-open observability fix) - the last
backend correction task, completed and WAITING_FOR_GPT_REVIEW. This
Firebase FCM task is a new, separate scope (Flutter Android client, not
backend) per GPT_TO_CLAUDE_FIREBASE_FCM_TASK.md.

THIS PASS:
- Added firebase_core (^4.14.0) and firebase_messaging (^16.6.0) to
  pubspec.yaml (versions resolved by `flutter pub add`, not guessed).
- Wired the Google Services Gradle plugin (settings.gradle.kts +
  app/build.gradle.kts) - google-services.json (already present,
  untouched) is now actually consumed.
- Added android.permission.POST_NOTIFICATIONS to AndroidManifest.xml.
- New lib/features/push/data/firebase_push_notification_service.dart -
  FirebaseMessagingPushService implements PushNotificationService, real
  FirebaseMessaging.instance calls for every method, plus a top-level
  background handler.
- lib/main.dart - safe, idempotent, Android-only Firebase bootstrap
  (Firebase.initializeApp() wrapped in try/catch; never crashes startup).
- lib/app/app.dart - Provider<PushNotificationService> now branches on
  Firebase.apps.isNotEmpty, mirroring the existing SupabaseConfig pattern.
- PushNotificationService interface gained one addition, onTokenRefresh -
  AuthController now subscribes and re-registers a rotated token for the
  currently signed-in user (guest-safe). AuthController.logout() now also
  calls unregisterDevice() (Firebase: deleteToken()) on top of the
  existing Supabase-side deactivation.
- No backend changes - FcmPushProvider (backend/src/push/fcm-provider.ts)
  already existed and already expects exactly this token shape.
- Tests: flutter test 147/147 passing (8 new: 4 pure toPushMessage()
  mapping tests + 4 new AuthController token-refresh/unregister tests).
  flutter analyze: 0 issues.
- flutter build apk --debug: succeeded (proves Gradle correctly parsed
  the real google-services.json).
- Real Android 14 emulator run: native Firebase SDK initialized
  successfully, FCM registration was genuinely attempted (failed only
  due to the emulator image's outdated Google Play Services, confirmed
  as an emulator limitation, not an MKR defect, by identical failures on
  unrelated pre-installed Google apps), zero app crashes, app confirmed
  via screenshot rendering normally into the full Home screen.
- Committed and pushed to origin/main. Working tree clean.

MANUAL STEPS STILL REQUIRED (documented, not fabricated):
1. Backend FCM secrets NOT yet configured in production - confirmed via
   `wrangler secret list` (names only): FCM_PROJECT_ID / FCM_CLIENT_EMAIL
   / FCM_PRIVATE_KEY are all missing. getPushProvider(env) still returns
   DisabledPushProvider until these are set - see
   docs/MKR-EXTERNAL-INTEGRATIONS.md section 2.2 for exact steps.
2. Verify real token registration/delivery on a physical device or a
   Play-Store-enabled AVD image - this environment's only available
   emulator has outdated Play Services.
3. pushNotificationsEnabled feature flag still defaults to false
   (unchanged, pre-existing) - flip on only after 1 and 2 are verified.

NEXT:
Claude has completed the Firebase FCM Integration Task and stopped, per
the task's own instruction. Waiting for GPT/M review. No further task
started.
