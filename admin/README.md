# MKR Admin Web

A lightweight, dependency-free static admin console for the MKR backend
(`../backend`). No build step, no framework - plain HTML/CSS/JS modules -
per the Phase 2 spec's "do not overengineer" / "lightweight" requirement.

## Local use

Just open `index.html` in a browser, or serve the folder with any static
file server, e.g.:

```bash
npx serve .
```

On first load it asks for the backend URL (e.g. `http://localhost:8787`
while running `wrangler dev` in `../backend`, or the deployed Worker URL)
and the admin password (set via `wrangler secret put ADMIN_PASSWORD` in the
backend). Both are stored in this browser's `localStorage` only.

## Deploying

Any static host works. Cloudflare Pages, matching the rest of the MKR
infrastructure:

```bash
npx wrangler pages deploy . --project-name=mkr-admin
```

After deploying, set `ADMIN_WEB_ORIGIN` in `../backend/wrangler.toml` to the
resulting Pages URL (e.g. `https://mkr-admin.pages.dev`) and redeploy the
backend - admin API CORS only ever allows that one configured origin, never
`*` (see `backend/src/cors.ts`).

## Pages

Dashboard · Providers · Symbols · Cache · Rate Limits · Feature Flags ·
System Health · Audit Logs · Settings - each a thin wrapper over one
`/api/mkr/admin/*` endpoint (see `api.js`).
