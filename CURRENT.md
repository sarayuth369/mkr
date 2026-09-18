PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-18 MKR Closed Testing Launch Crash / Release 2 One-Pass
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_CLOSED_TEST_LAUNCH_CRASH_FIX_ONE_PASS.md
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: 969392a
VERSION: 1.0.0+1 -> 1.0.1+2 (versionCode 2)

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_CLOSED_TEST_LAUNCH_CRASH_FIX_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR app-ads.txt + Developer Website One-Pass, completed, was
WAITING_FOR_GPT_REVIEW (commit ecf6cb9).

INCIDENT: the Closed Testing install flashed and closed immediately on
every launch - unusable.

ROOT CAUSE (confirmed via adb logcat on a real reproduced crash, not
assumed): com.google.android.gms:play-services-ads-api (pulled in
transitively by google_mobile_ads) depends on androidx.work:work-runtime.
WorkManager's ContentProvider-based auto-init
(androidx.startup.InitializationProvider -> WorkManagerInitializer) runs
EAGERLY at Application process attach - before MainActivity, the Flutter
engine, or ANY Dart code (including main.dart's runZonedGuarded) ever
runs. Two compounding factors made this throw: (1) nothing else in the
dependency tree pulls a newer work-runtime, so Gradle resolved a stale
2.7.0 whose bundled Room 2.2.5/sqlite transitives were version-skewed
against sqlite resolved elsewhere; (2) the test runtime's installed
Google Play services was behind what play-services-ads-api expected
(logcat: "Google Play services out of date... Requires 261200000 but
found 231818047" immediately before the fatal exception). Because this
happens during ContentProvider.attachInfo (part of
Application.bindApplication), NO Dart-level try/catch can ever run early
enough to prevent it - this is why the crash exactly matches "flash and
close every time" and is not device-specific superstition.

FIX (two-part, native/Android-side only, no Dart code changed):
1. android/app/build.gradle.kts - force a single coherent
   androidx.work:work-runtime:2.9.1 app-wide (was silently resolving to
   2.7.0 alone with mismatched Room/sqlite transitives - confirmed via
   `gradlew :app:dependencies` before/after).
2. android/app/src/main/AndroidManifest.xml - disable WorkManager's eager
   auto-init ContentProvider via the standard tools:node="remove"
   manifest-merge pattern (Google's own documented "on-demand
   initialization" workaround). Confirmed nothing in this app needs
   WorkManager ready at process start (no workmanager plugin, no direct
   androidx.work usage) - the ads SDK only needs it lazily for
   non-critical background telemetry. This is what actually stops the
   crash (fix #1 alone did NOT resolve it on retest - same crash, a
   different Room-version error string - confirming the Play-services
   staleness was the actual proximate trigger, not only the version
   skew).

Neither AdMob, Billing, nor Firebase was removed/weakened. No market-data
architecture or Alpaca hybrid flags touched.

VERIFIED ON REAL ANDROID RUNTIME: no physical device was connected to
this session's environment (adb devices returned empty throughout), so
reproduction and fix verification were performed on a local Android 14
(API 34) AVD emulator running the actual compiled release APK (not a
mock). Pre-fix: crash reproduced on every launch via adb logcat. Post-fix:
process stays alive (confirmed via `ps` + a full-session unfiltered
logcat sweep showing zero AndroidRuntime:E fatal exceptions), and Home,
Markets, Settings, and the Paywall/Billing screen (live Play Store
pricing loaded, test AdMob ads rendered correctly) were all manually
exercised via adb input taps + screenshots with no crash. The crash
mechanism (a ContentProvider-level native crash at Application attach) is
not emulator-specific, but the operator should still do one real-device
install from the new Closed Testing release for direct confirmation on
their own hardware.

REGRESSION:
- flutter analyze: no issues found.
- flutter test: 384/384 passing (no Dart logic changed - this was a
  native Android build-config fix).
- Backend: not touched, no backend tests run (no backend files changed).
- flutter build apk --release: succeeds (58.7MB).
- flutter build appbundle --release: succeeds (59.6MB).
- Android runtime smoke test with logcat: pass (crash reproduced pre-fix,
  confirmed gone post-fix, on the same release-configuration build).
- Signing: real upload keystore confirmed used (not debug fallback) -
  CN=Sarayuth Lorsrichandr, OU=BKKNEX; SHA-256
  9354da41f22d6682dd383507a9f7cc60ade2b457043a561367c5a6307d16f4c8.
- Security scan: git diff grepped for credential patterns across the
  full diff - zero matches. Only 3 files changed
  (build.gradle.kts/AndroidManifest.xml/pubspec.yaml). auc/backend
  confirmed untouched (outside this repo entirely).

FINAL ARTIFACTS:
- APK: D:\FlutterProjects\mkr\build\app\outputs\flutter-apk\app-release.apk (58.7MB)
- AAB: D:\FlutterProjects\mkr\build\app\outputs\bundle\release\app-release.aab (59.6MB)
- versionCode 2 / versionName 1.0.1 confirmed via aapt dump badging.

REMAINING OPERATOR ACTIONS:
1. Play Console -> Testing -> Closed testing -> Create new release ->
   upload the new AAB above (versionCode 2). Do NOT reuse/upload the old
   versionCode 1 artifact - it contains the crash.
2. Roll out to Closed Testing track; ask testers to fully uninstall the
   old build first for the cleanest confirmation.
3. Recommended: do one direct install on the operator's own physical test
   device for real-hardware confirmation beyond this pass's emulator
   verification.
4. AdMob app-ads.txt crawler confirmation (from the prior pass) remains
   independently pending on Google's side, unaffected by this fix.

NEXT:
Claude has completed this pass and stopped, per its own instruction - no
serial loop, no new GPT_TO_CLAUDE sub-task created beyond the one
material blocker discovered and resolved mid-investigation (the
Play-services staleness compounding factor, found only after the first
fix attempt didn't resolve the crash - explicitly permitted by the task's
own "unless a new material blocker is discovered" clause). Waiting for
GPT review.
