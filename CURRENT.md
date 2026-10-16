PROJECT: MKR (subproject: minvest)

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-10-16 minvest - Production UX, Portfolio Management, FX Conversion & Secure Settings
TITLE: Edit/delete history rows, password change (Durable Object), USD->THB (ECB) + Total THB, footer removal
STATUS: WAITING_FOR_GPT_REVIEW  (result: PARTIAL - authenticated production smoke test needs the owner's login)

COMMIT: see git log (minvest enhancements commit after aa6e778)
CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MINVEST_ENHANCEMENTS_REPORT.md
(earlier: ..._IMPORT_REPORT.md, ..._DEPLOY_REPORT.md, ..._ONE_PASS_REPORT.md)

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

RESULT:
- Worker minvest deployed (version 905e4177), new Durable Objects AuthStore + FxStore (this Worker only). Apps Script web app updated to Version 3 on the same /exec URL; mvRunSetup run once.
- Tests 158/158, tsc/build clean. Real Sheet read-only check: Historical_* still 606/366/297 (1,269), headers migrated, Audit_Log created, no duplicates.
- Production negative tests PASS (auth, CSRF, DO wiring, footer gone, mkr-backend untouched).
- NOT verified in production: logged-in dashboard, record edit/delete, password-change success, live FX/Total THB (needs owner login).

OWNER ACTIONS:
1. Log in, run the 4 checks listed at the end of the report, tell Claude the result.
2. Recommended: change the password via Settings (an old notes file once held credentials) and delete minvest/data/OWNER-NOTES-DO-NOT-COMMIT.txt.

NEXT:
Claude has completed this pass and stopped. Waiting for GPT review / owner command.
