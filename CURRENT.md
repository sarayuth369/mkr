PROJECT: MKR (subproject: minvest)

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-10-16 minvest - Investment Income Dashboard One-Pass
TITLE: READ -> AUDIT -> PLAN -> IMPLEMENT -> TEST -> BUILD -> VERIFY -> REPORT -> COMMIT -> PUSH (user /plan prompt, no task file)
STATUS: WAITING_FOR_GPT_REVIEW

COMMIT: e7dc076
CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MINVEST_ONE_PASS_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Monetization Correction + Release 3 One-Pass, completed, was
WAITING_FOR_GPT_REVIEW (commit 31a5f3f, docs ee8dc1d).

THIS PASS SUMMARY:
New isolated project D:\FlutterProjects\mkr\minvest (35 files): Google Sheets (database)
+ Google Apps Script (Code.gs) + isolated Cloudflare Worker `minvest` + Thai responsive
dashboard + idempotent Excel importer + Thai deploy/usage guide. Nothing in MKR
production (backend, admin, Flutter app, Alpaca/hybrid flags) was touched; auc/backend
untouched.

KEY RESULTS:
- Real Excel (value infox.xlsx) reconciled: 1,269 date rows imported (Dime 606,
  StashAway 366, Webull 297) + 60 month headers recorded; every non-empty row
  accounted for. Flagged for owner review (kept raw, not charted): 2 malformed
  numbers, 1 withdrawal-amount row, same-day superseded rows, 5 three-decimal
  values; 26 deposit/withdrawal/dividend hints await owner confirmation.
- Import is idempotent (second push inserted 0 of 1,269) - verified through the
  local CLI -> Worker -> Apps Script-logic chain (MOCK upstream, not real Sheets).
- Values are never treated as income; no profit derived from value change; THB/USD
  never mixed or converted; forecast excludes deposit jumps and refuses thin data.
- Security: HMAC session cookie, CSRF origin check, native rate limiting, validation
  at Worker + Apps Script, SSRF guard, strict CSP, no CORS, no public caching,
  no secrets in code/log/Git. Repo is PUBLIC -> real portfolio figures scrubbed from
  tests/docs; data/, *.xlsx, .dev.vars git-ignored and local copies deleted.
- Tests: 88/88 (mock Apps Script, Worker, analytics, normalizer, real-Excel invariants);
  typecheck/build clean; browser-verified locally (desktop + 375px metrics).
- Bugs found+fixed during verification: 3-decimal import batch rejection, Windows
  importer crash on error paths, chart axis padding, Thai conflict message.

NOT VERIFIED (no access from this session): real Google Sheets/Apps Script, production
login with real secrets, the Apps Script /exec redirect hop.

CLOUDFLARE: wrangler here is logged into a DIFFERENT account (subdomain bkknex369)
than MKR's (subdomain biz2success). A temporary deploy was used for runtime smoke
tests (headers/401/CSRF/no-CORS/rate-limit bindings OK) and then DELETED
(https://minvest.bkknex369.workers.dev -> 404). Production deploy is pending owner.

PENDING OWNER ACTION:
1. Apps Script: bind to sheet `minvestment`, paste Code.gs + appsscript.json, set
   Script properties SPREADSHEET_ID + MINVEST_SCRIPT_SECRET, deploy web app
   (execute as me, access anyone), copy /exec URL. (Spreadsheet ID was not provided
   anywhere; never searched by name.)
2. `npx wrangler login` with MKR's account; verify `wrangler whoami`; set secrets
   MINVEST_PASSWORD, MINVEST_SESSION_SECRET, MINVEST_SCRIPT_URL, MINVEST_SCRIPT_SECRET;
   `npm run deploy` -> expected https://minvest.biz2success.workers.dev (custom domain
   optional via dashboard; none was verifiable).
3. `node tools/import-excel.mjs --file "<value infox.xlsx>" --push`, then review
   Import_Review / Cashflow_Review.
4. Record confirmed deposits/withdrawals, then set "confirmed through" date in Settings
   to enable cashflow-adjusted return.
Full steps (Thai): minvest/docs/MINVEST_GUIDE_TH.md

NEXT:
Claude has completed this pass and stopped, per its own instruction - no serial loop.
Waiting for GPT review.
