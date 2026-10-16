PROJECT: MKR (subproject: minvest)

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-10-16 minvest - Excel to Google Sheets Production Import
TITLE: Verify, import 1,269 historical rows into the real Google Sheet, read back, verify Dashboard
STATUS: WAITING_FOR_GPT_REVIEW  (result: PASS)

COMMIT: see git log (minvest import commit after dd8244d)
CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MINVEST_IMPORT_REPORT.md
(earlier: CLAUDE_TO_GPT_MINVEST_DEPLOY_REPORT.md, CLAUDE_TO_GPT_MINVEST_ONE_PASS_REPORT.md)

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

RESULT (real Google Sheet "minvestment", production Worker https://minvest.biz2success.workers.dev, version 010d4ce8):
- Before: Historical_* all 0 rows, Daily_Income 1 void smoke row, no cashflows, no prior import.
- Imported: Dime 606, StashAway 366, Webull 297 = 1,269 rows (+70 Import_Review, +26 Cashflow_Review suggestions);
  canary first (3 rows, resend inserted 0, exact readback), then full import, full readback field-by-field: 47/47 checks PASS,
  independent read-only re-check matches; re-send of 125 sample rows + all 96 review items inserted 0 (idempotent).
- Dashboard (production): series 598/366/297 points equal the cleaned source; Daily_Income and KPIs untouched
  (0 active entries); cashflows still 0; adjusted return still "not ready"; forecast available; no smoke row in KPIs.
- Not promoted to "confirmed": 2 malformed Dime numbers (raw kept, not charted), 1 withdrawal-amount row, 2 USD-event rows,
  5 three-decimal values (preserved), 26 deposit/withdrawal/dividend hints (pending owner confirmation).
- Method change: hidden terminal password prompt was unusable, so the guarded import was moved into a shared module and a
  web panel ("นำเข้าข้อมูลย้อนหลัง"), run in the owner's already-logged-in Chrome (no password typed/seen by Claude).
- Tests 98/98, build/typecheck clean; no secrets or financial figures in Git; local data/dev files deleted.
- auc/backend, mkr-backend, mkr-admin, Alpaca/hybrid flags untouched.

OWNER ACTIONS (none block use):
1. Optional: redeploy Apps Script with the updated Code.gs (grid-growth fix for future imports > 1,000 rows/sheet; live writes unaffected).
2. Review Import_Review; optionally correct the 2 malformed Dime cells.
3. Record confirmed deposits/withdrawals/dividends (Cashflow_Review is the checklist), then set the "confirmed through" date in Settings.
4. Voided smoke row stays in Daily_Income (excluded from KPIs); delete manually in Sheets only if desired.

NEXT:
Claude has completed this pass and stopped. Waiting for GPT review.
