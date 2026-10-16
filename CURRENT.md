PROJECT: MKR (subproject: minvest-android)

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-10-16 MINVEST Android APK - one-shot build & delivery
STATUS: WAITING_FOR_GPT_REVIEW  (result: PASS with limits - emulator-tested, debug-key signed)

COMMIT: see git log (minvest-android commit after 5060201)
CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MINVEST_ANDROID_REPORT.md
(earlier: CLAUDE_TO_GPT_MINVEST_ENHANCEMENTS_REPORT.md)

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md; both kept in sync.

RESULT:
- APK minvest-android\release\MInvest-1.0.0.apk (2.8 MB, com.biz2success.minvest 1.0.0(1), minSdk 24), Capacitor 6 WebView on production URL, same-host navigation only.
- Emulator PASS: install, login page, login+dashboard (local test backend), session persistence, Back, offline page + retry. Not tested: physical phone, external-link block live, CSV name re-test, real password login on production.
- Icon: full-bleed green adaptive icon (ring fixed). Worker redeployed (2fa70917) with in-app CSV + dark default + non-sticky mobile header.
- Open item: hygiene test fails on owner's untracked minvest/docx/info.txt (not touched).

OWNER ACTIONS: install APK (README_TH.md), log in, try CSV export; provide own release keystore if distributing; move/delete minvest/docx/info.txt.

NEXT:
Claude has completed this pass and stopped. Waiting for GPT review / owner command.
