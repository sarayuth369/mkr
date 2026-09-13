# MKR Backend

The single market-data gateway for Market Radar (MKR). A Cloudflare Worker
that Flutter talks to over HTTPS/WebSocket — Flutter never calls Twelve Data
or Alpaca directly, and never holds an API key.

**Deployed**: `https://mkr-backend.biz2success.workers.dev` · Admin Web:
`https://mkr-admin.pages.dev` · D1 `mkr-db`, KV `MKR_CONFIG`/`MKR_CACHE`,
Durable Object `MarketStreamRoom` all provisioned and bound. `TWELVE_DATA_API_KEY`,
`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` are set; Alpaca secrets are not
(standby, disabled).

**Known limitation — Twelve Data Free's real throughput**: empirically,
this account's free tier serves reliably in batches of ~8 quotes per
request/minute window, not MKR's full ~28-symbol default catalog at once.
`getBatchQuotes` chunks requests (8 provider symbols per upstream call,
chunks fired concurrently) so a screen needing many quotes costs a handful
of upstream calls instead of one-per-symbol — a real, load-bearing fix
(confirmed live: 28 concurrent individual quote calls made every single one
come back `PROVIDER_UNAVAILABLE`). But the free plan's own per-minute credit
ceiling is an external constraint no amount of client-side batching removes:
expect some symbols to honestly show unavailable/stale immediately after a
cold cache, filling in as caching (60s TTL) carries earlier successes
forward. This is intentional, honest behavior — never fabricated data — not
a bug. The two ways to fully resolve it are outside this change's scope by
the product owner's own instruction: upgrade the Twelve Data plan, or trim
the default catalog fetched per screen. See
docs/MKR-PHASE2-ARCHITECTURE.md for detail.

```
Flutter  --HTTPS/WS-->  MKR Worker  -->  Twelve Data (primary)
                             |      -->  Alpaca (standby, disabled by default)
                             |
                     KV cache / D1 config / Durable Object WS fan-out
```

This is a **new, isolated** Worker — it does not reuse or modify any other
Cloudflare project. (`D:\FlutterProjects\auc\backend`, a separate live
Worker for a different app, was inspected during planning and confirmed
unrelated to MKR; nothing there was touched.)

## Architecture

- **`src/index.ts`** — router, CORS, rate limiting, error envelope.
- **`src/providers/`** — `MarketDataProvider` interface, `TwelveDataProvider`
  (primary), `AlpacaProvider` (standby), `MarketProviderManager` (failover),
  `provider-registry.ts` (pluggable construction — adding a future provider
  is one new file + one `switch` case, never a route change).
- **`src/symbols/`** — `SymbolCatalog` (D1-backed MKR↔provider symbol table)
  and pure mapping/validation logic.
- **`src/cache/`** — KV-backed response cache with per-isolate in-flight
  request de-duplication.
- **`src/config/`** — KV-backed runtime config (feature flags, provider
  toggles, cache TTLs, rate limits) that Admin Web edits without a redeploy.
- **`src/ws/`** — `MarketStreamRoom`, a Durable Object holding the **one**
  shared upstream Twelve Data WebSocket connection and fanning normalized
  ticks out to every connected Flutter client.
- **`src/admin/`** — session-token auth, admin route handlers, audit log.
- **`src/market/`** — the public `/api/mkr/market/*` route handlers.

See `../docs/MKR-PHASE2-ARCHITECTURE.md` for the full request-flow diagram
and the design tradeoffs (caching, failover, WebSocket fan-out).

## Environment variables (`wrangler.toml [vars]` — safe to commit)

| Variable | Purpose |
|---|---|
| `MARKET_PRIMARY_PROVIDER` | `twelve_data` (default) |
| `MARKET_SECONDARY_PROVIDER` | `alpaca` |
| `MARKET_SECONDARY_ENABLED` | `false` by default — see Licensing below |
| `CACHE_QUOTE_TTL_SECONDS`, `CACHE_CANDLE_INTRADAY_TTL_SECONDS`, `CACHE_CANDLE_DAILY_TTL_SECONDS`, `CACHE_STATUS_TTL_SECONDS`, `STALE_THRESHOLD_SECONDS` | Cache TTL defaults; overridable at runtime from Admin Web |
| `RATE_LIMIT_PUBLIC_PER_MINUTE`, `RATE_LIMIT_ADMIN_PER_MINUTE`, `RATE_LIMIT_WS_MAX_CONNECTIONS` | Rate-limit defaults; overridable from Admin Web |
| `ADMIN_WEB_ORIGIN` | The deployed Admin Web origin — admin CORS never uses `*` |

Runtime overrides made from Admin Web live in the `MKR_CONFIG` KV namespace
and take precedence over these defaults without a redeploy.

## Secrets (never committed — `wrangler secret put <NAME>`)

| Secret | Required for |
|---|---|
| `TWELVE_DATA_API_KEY` | Any real (non-mocked) market data. **Reuse the product owner's existing key — do not create a new Twelve Data account.** |
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | Only if/when Alpaca is activated (see Licensing) |
| `ADMIN_PASSWORD` | Signing in to Admin Web |
| `ADMIN_SESSION_SECRET` | Signing admin session tokens — any random 32+ byte string, e.g. `openssl rand -base64 32` |

Without `TWELVE_DATA_API_KEY` configured, `/api/mkr/market/*` honestly
returns `PROVIDER_UNAVAILABLE` rather than fabricating data — this is by
design (see Phase 1's data-honesty rule) and is exactly the state the
automated test suite runs in (mocked HTTP responses, no real key needed).

### Phase 2.2+ secrets (optional — everything they unlock fails safely without them)

| Secret | Required for | Notes |
|---|---|---|
| `SUPABASE_URL` | Alert index refresh, admin Users/Alerts/Push/Notification-Logs/Subscriptions | Same value as Flutter's `SUPABASE_URL` `--dart-define` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as above | **Never the anon key.** Bypasses Row Level Security — backend-only, never in Flutter |
| `FCM_PROJECT_ID` | Push notifications | Firebase project id |
| `FCM_CLIENT_EMAIL` | Push notifications | Service-account `client_email` |
| `FCM_PRIVATE_KEY` | Push notifications | Service-account `private_key` (PEM) — all three `FCM_*` required together |

Copy `.dev.vars.example` to `.dev.vars` (gitignored) to exercise these
locally; leaving any of them out is exactly the "not configured" path the
test suite (`test/alert-engine.test.ts`, `test/push-provider-factory.test.ts`,
`test/supabase-client.test.ts`) already covers. See
`../docs/MKR-EXTERNAL-INTEGRATIONS.md` for exactly how to obtain each value.

## User data, alerts, push (Phase 2.2 – 2.3)

Market data (above) is entirely separate from user data. Supabase owns
auth/profiles/watchlists/alerts/devices/notification history/subscriptions;
this Worker only ever reads it with the service-role key for:

- **Alert Engine** (`src/alerts/`) — a Cron Trigger (`[triggers] crons` in
  `wrangler.toml`, once a minute) refreshes a KV-cached index of active
  alerts (`alerts:index`); `MarketStreamRoom` calls `evaluateTick()` on
  every upstream tick — independent of whether any Flutter client is
  connected — which reads *only* that KV index, never Supabase per tick.
  PRICE_ABOVE/PRICE_BELOW evaluation + per-alert cooldown + a per-isolate
  duplicate-concurrent-trigger guard live in `alert-engine.ts` as pure,
  directly-unit-tested functions (`conditionMet`/`isCooledDown`).
- **Push** (`src/push/`) — `PushProvider` interface, `FcmPushProvider` (FCM
  HTTP v1, hand-rolled OAuth2 JWT signing via WebCrypto, no SDK dependency)
  and `DisabledPushProvider` (always fails cleanly). `getPushProvider(env)`
  picks based on whether all three `FCM_*` secrets are present — never a
  fake successful send.
- **Supabase client** (`src/supabase/supabase-client.ts`) — a minimal
  hand-rolled PostgREST/Auth-Admin wrapper, matching the same
  hand-rolled-HTTP-provider style already used for Twelve Data/Alpaca
  rather than adding `@supabase/supabase-js` for a handful of calls.

To manually fire the Cron Trigger locally (Wrangler doesn't auto-trigger
scheduled Workers in `wrangler dev`):

```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

## Local development

```bash
npm install
wrangler kv:namespace create MKR_CONFIG   # then paste the id into wrangler.toml
wrangler kv:namespace create MKR_CACHE
wrangler d1 create mkr-db                 # then paste the id into wrangler.toml
wrangler d1 execute mkr-db --local --file=./schema.sql
wrangler secret put TWELVE_DATA_API_KEY   # optional locally - omit to exercise the offline/error path
npm run dev
```

## Deployment

```bash
wrangler d1 execute mkr-db --file=./schema.sql   # once, against the remote DB
wrangler secret put TWELVE_DATA_API_KEY
wrangler secret put ADMIN_PASSWORD
wrangler secret put ADMIN_SESSION_SECRET
npm run deploy
```

Then point the Flutter build at it:

```bash
flutter build apk --dart-define=MARKET_DATA_MODE=real --dart-define=MARKET_BACKEND_BASE_URL=https://<your-worker>.workers.dev
```

Nothing here was auto-deployed by this change — see the final report for
exactly what remains manual.

## API

All responses use `{"success": true, "data": ...}` or
`{"success": false, "error": {"code", "message"}}`. Error codes:
`INVALID_SYMBOL`, `INVALID_INTERVAL`, `INVALID_PARAMETER`,
`PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMIT`,
`AUTH_REQUIRED`, `ADMIN_FORBIDDEN`, `RATE_LIMITED`, `NOT_FOUND`,
`INTERNAL_ERROR`.

### `GET /api/mkr/market/quote?symbol=XAU/USD`

```json
{"success": true, "data": {
  "symbol": "XAU/USD", "name": "Gold Spot", "price": 3412.8,
  "change": 18.4, "changePercent": 0.54, "open": 3394.4, "high": 3421.1,
  "low": 3388.2, "previousClose": 3394.4, "volume": null, "bid": null,
  "ask": null, "currency": "USD", "timestamp": 1234567890000,
  "source": "twelve_data", "isLive": true, "sessionStatus": "open"
}}
```

`data` is `null` for a genuinely healthy-but-empty result (never fabricated).

### `GET /api/mkr/market/quotes?symbols=XAU/USD,AAPL,MSFT`

Partial success — one bad symbol never fails the batch:

```json
{"success": true, "data": {
  "items": [ /* NormalizedQuote objects for the symbols that resolved */ ],
  "errors": [{"symbol": "MSFT", "code": "PROVIDER_TIMEOUT", "message": "..."}],
  "source": "twelve_data", "timestamp": 1234567890000
}}
```

### `GET /api/mkr/market/candles?symbol=AAPL&interval=d1&outputsize=30`

`interval` is one of `m1 m5 m15 h1 h4 d1 w1 mo1`. `data` is an oldest-first
array of `{symbol, interval, timestamp, open, high, low, close, volume, source}`.

### `GET /api/mkr/market/status?symbol=AAPL`

`{"symbol", "market", "exchange", "session": "open|closed|pre_market|after_hours|unknown", "isOpen", "timestamp", "source"}`.
`isOpen`/`session` are `null`/`unknown` rather than guessed when the
provider doesn't report a session.

### `GET /api/mkr/market/health`

```json
{"success": true, "data": {
  "primary": {"provider": "twelve_data", "status": "healthy", "latencyMs": 123, "lastSuccessAt": ..., "lastErrorAt": null, "lastErrorMessage": null, "errorCount": 0},
  "secondary": {"provider": "alpaca", "status": "disabled", "latencyMs": null, ...}
}}
```

### `GET /api/mkr/health`, `GET /api/mkr/version`

Plain liveness/version endpoints, no auth.

### WebSocket `wss://<host>/api/mkr/market/stream`

Client → server: `{"action": "subscribe" | "unsubscribe", "symbols": ["AAPL", "XAU/USD"]}`
(plain MKR symbols — the backend maps to the provider symbol internally).

Server → client tick: `{"symbol": "AAPL", "price": 227.5, "timestamp": 1234567890000, "source": "twelve_data"}`

One shared upstream Twelve Data connection serves every connected client
(see `src/ws/market-stream-do.ts`); subscriptions are ref-counted so the
upstream unsubscribes/disconnects once nobody needs a symbol.

### Admin API — `/api/mkr/admin/*`

`POST /login {password}` → `{token, expiresAt}` (rate-limited to 5/min/IP).
Every other admin route requires `Authorization: Bearer <token>` and is
rate-limited separately from the public API. See `src/admin/admin-routes.ts`
for the Phase 2 list (`dashboard`, `providers`, `symbols`, `cache`,
`rate-limits`, `features`, `health`, `logs`, `settings`).

**Phase 2.4 additions** (`src/admin/admin-users-routes.ts`,
`admin-alerts-routes.ts`, `admin-push-routes.ts`) — every one of these
returns `{"configured": false}` cleanly instead of erroring when Supabase
isn't set up:

- `GET /users?page&q&status&emailConfirmed&sort` — totals + paginated user
  list. "Guest" never appears here — it's a client-side-only concept, never
  a fabricated Supabase Auth account. Server-side-paginated against
  GoTrue's own `page`/`per_page`; `q`/`status`/`emailConfirmed`/`sort`
  scan up to 5 pages in memory (GoTrue's raw Admin API has no server-side
  search/sort of its own — documented in MKR-PHASE2-ARCHITECTURE.md).
- `GET /users/:id` — Auth fields (email, confirmed, suspended, created,
  last sign-in, user_metadata), profile, watchlist item count, active
  alerts, devices, subscription. No secrets/passwords ever included.
- `PATCH /users/:id {email?, displayName?}` — admin edit; an email change
  always requires the user to reconfirm the new address (`email_confirm:
  false`), never treated as pre-verified. Audit-logged `USER_UPDATED`.
- `POST /users/:id/suspend` / `POST /users/:id/unsuspend` — real Supabase
  Auth ban via `ban_duration` (`"876000h"` / `"none"`), not a UI-only flag —
  a suspended user is rejected on sign-in. Audit-logged `USER_SUSPENDED`/
  `USER_UNSUSPENDED`.
- `DELETE /users/:id {confirmEmail}` — hard-deletes the Auth user
  (`confirmEmail` must match the target's actual email, re-verified
  server-side, never trusting the Admin Web UI's own check alone). Every
  MKR table cascades from `auth.users(id)`, so this also removes the
  user's profile/watchlists/alerts/devices/preferences/subscriptions/
  notification_logs. Audit-logged `USER_DELETED`.
- `GET /alerts?status=active|triggered|disabled&symbol=...` — user-created
  price alerts (not to be confused with Phase 2's provider config).
- `POST /alerts/toggle {alertId, enabled}` — admin enable/disable; always
  audit-logged (`alert.enabled.changed`).
- `POST /push/test {deviceId, title?, body?}` — one real send to one device;
  returns `{configured:false}` if `pushNotificationsEnabled` is off or FCM
  isn't configured, never a fake success.
- `POST /push/announcement {audience: "all"|"registered"|"pro", title, body, confirm:true}`
  — mass push; refuses without `confirm:true`. Every send audit-logged
  (`push.announcement_sent`/`push.test_sent`).
- `GET /notification-logs?limit=100` — sent/failed history, never provider credentials.
- `GET /subscriptions` — plan/status counts (provider-agnostic; Google Play
  Billing itself is not implemented).

## Provider failover

`Twelve Data (primary) → [confirmed unhealthy via healthCheck] → Alpaca (if MARKET_SECONDARY_ENABLED)`.
A single failed request does **not** trigger failover by itself — the
manager re-probes `healthCheck()` first; if the primary is still reachable,
the original error is propagated (a transient timeout/rate-limit, not an
outage). A healthy-but-empty quote (e.g. an unsupported symbol, or simply
"nothing to report") is returned as `data: null` and never counted as a
failure. See `src/providers/provider-manager.ts` and its tests.

## Caching

**Note:** Cloudflare KV rejects any `expirationTtl` under 60 seconds
outright (confirmed against the live API during deployment) — every cache
TTL default is 60s+ accordingly, and Admin Web's cache settings page
enforces the same floor. A Cache-API-backed path is the documented
upgrade if sub-60s quote freshness is ever needed (see the architecture
doc's tradeoffs section).

KV-backed, TTL-based, plus per-isolate in-flight request de-duplication —
concurrent requests for the same symbol collapse into one upstream call
(see `src/cache/cache-service.ts`). Cross-isolate concurrent misses can
each make one upstream call (KV has no compare-and-swap); a Durable-Object
single-flight lock would close that gap fully and is a documented future
enhancement, not built now to avoid overengineering an early-stage product.

## Security

- No API key/secret ever appears in `[vars]`, source, git history, logs, or
  any response body — see `src/logging.ts`'s redaction and
  `src/admin/audit-log.ts`'s "refuse to log anything secret-shaped" guard.
- Symbols are validated by format (`src/symbols/symbol-mapper.ts`) and
  against the D1 catalog before ever reaching a provider call — no
  user-controlled string reaches an upstream URL unvalidated.
- No `/proxy?url=...`-style endpoint exists anywhere; every upstream call
  targets a hardcoded host.
- Admin endpoints require a signed session token; CORS for admin endpoints
  is restricted to `ADMIN_WEB_ORIGIN`, never `*`.

## Licensing

Twelve Data: this gateway calls it server-side; production public display
requires whatever plan/rights the product owner's Twelve Data account
actually carries — this code does not change or expand that. Alpaca:
implemented and wired but **disabled by default**
(`MARKET_SECONDARY_ENABLED=false`) because its commercial redistribution
rights for MKR have not been confirmed — do not flip this in production
until that is resolved.
