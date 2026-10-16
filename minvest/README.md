# minvest

Personal investment income dashboard (Dime / StashAway / Webull) — a subproject of MKR Market Radar.
Google Sheets is the database; a Google Apps Script web app reads/writes it; an isolated Cloudflare Worker
(`minvest`) serves the static UI and a small authenticated API in front of the script.

Thai deploy + usage guide: [docs/MINVEST_GUIDE_TH.md](docs/MINVEST_GUIDE_TH.md)

```
browser ──cookie──▶ Worker `minvest` ──shared secret──▶ Apps Script web app ──▶ Google Sheet "minvestment"
```

| Path | What |
|---|---|
| `src/` | Worker: auth (HMAC session cookie), CSRF origin check, rate limiting, validation, Apps Script client, static serving + security headers |
| `public/` | Dashboard (HTML/CSS/vanilla JS + Chart.js vendored; strict CSP, no inline scripts/styles) |
| `apps-script/` | `Code.gs` + `appsscript.json` for the Google Apps Script project |
| `tools/` | `import-excel.mjs` (Excel → normalized → idempotent push), `normalize.mjs`, `mock-upstream.mjs` (local stand-in, **not** real Sheets) |
| `test/` | vitest: normalizer, Apps Script logic (mock), Worker, analytics, and a real-Excel suite (runs only if the file exists) |

Key rules baked in: Excel values are **portfolio values, not income**; THB and USD are never mixed or converted unless the
owner sets a rate; no profit is derived from value changes; forecasts are labelled estimates and refuse to run on thin data;
all personal data (`data/`, `*.xlsx`, `.dev.vars`) is git-ignored.

```bash
npm install && npm run build && npm test
npx wrangler secret put MINVEST_PASSWORD   # + MINVEST_SESSION_SECRET, MINVEST_SCRIPT_URL, MINVEST_SCRIPT_SECRET
npm run deploy                              # only while `wrangler whoami` shows MKR's Cloudflare account
```
