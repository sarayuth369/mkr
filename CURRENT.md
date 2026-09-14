PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: Firebase FCM Token-Refresh Session Race Fix
TITLE: Extend session-epoch protection to _onTokenRefresh()
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_FIREBASE_FCM_TOKEN_REFRESH_RACE_REPORT.md

FULL REPORT:
D:\FlutterProjects\gpt-claude\MKR_FIREBASE_FCM_TOKEN_REFRESH_RACE_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
Firebase FCM Final Cleanup - completed, was WAITING_FOR_GPT_REVIEW. Mac
reviewed the actual code: architecture + all prior findings PASS. Found 1
remaining token-refresh/session race, issued as this final correction.

THIS PASS:
- Fixed: _onTokenRefresh() was not protected by the session-epoch
  mechanism _registerDeviceIfPossible already uses -
  DeviceRepository.registerDevice() (a real network write) could still be
  in flight when logout()/a session change happened, and the old code used
  a captured profile unconditionally once it resolved.
- IMPORTANT finding during implementation, verified empirically (not just
  by reading the code): a bare "capture epoch+profile, check right before
  the write" is a NO-OP for _onTokenRefresh's structure, because there is
  no await between capture and write for a concurrent change to land in
  (unlike _registerDeviceIfPossible, which has real async work -
  initialize/requestPermission/getToken - before ITS check). Confirmed via
  a diagnostic completer + full call-log: the stale write WAS genuinely
  issued and resolved in the naive version, just silently overwritten
  afterward by a later, correct write.
- Fixed properly by ALSO calling _pushService.initialize() before the
  check - the SAME idempotent call _registerDeviceIfPossible already
  makes (a documented no-op once already initialized), not a new/
  artificial synchronization primitive. This gives the epoch/profile
  check a genuine window to observe a concurrent session change before
  the write is ever issued. Re-verified empirically: stale write no
  longer issued at all.
- Reviewed _onTokenRefresh() for any other stale-session issue - none
  found, nothing else changed.
- Tests: flutter test 164/164 passing (was 160, +4 new: scenarios A/B/C/D
  exactly as specified). flutter analyze: 0 issues. flutter build apk
  --debug: succeeds.
- Tests A and D verified via revert to fail against the pre-fix code with
  the exact stale-write symptom; B and C correctly pass either way (never
  broken).
- No Android/Gradle files, google-services.json, pubspec, or backend
  files touched - exactly this one finding.
- Committed (c0896b3) and pushed to origin/main. Working tree clean.

UNCHANGED FROM PRIOR REPORTS (not re-verified, no live-device changes this pass):
- Backend FCM secrets (FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)
  remain unconfigured in production.
- Real end-to-end token delivery still requires a physical device or a
  Play-Store-enabled AVD to verify.

RESIDUAL, INHERENT LIMITATION (documented, not fixable without forbidden
cancellation infrastructure):
- Once registerDevice()'s call has genuinely been issued (epoch check
  already passed), a session change during THAT specific write's own
  network latency cannot retroactively abort it. This fix closes the gap
  at the earliest point staleness is knowable, not via mid-flight
  cancellation.

NEXT:
Claude has completed this token-refresh session-race fix and stopped, per
its own instruction. Waiting for GPT/M review. No further task started.
