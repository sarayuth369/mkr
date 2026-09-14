# MKR Market Data Pooling & Caching Architecture

## ADR-001 — Market Pool Core, KV Remediation, Request Coalescing

**Status:** ACCEPTED / PARTIALLY IMPLEMENTED (this document tracks exactly which parts, and why the rest is deliberately deferred rather than rushed).

This ADR records the architecture decision from the prior read-only audits (Market Data Pooling & Caching Architecture audit, then the KV PUT Quota Incident Investigation — both delivered in-session before this implementation pass) and the outcome of actually implementing it. Every decision below carries an explicit **Implementation status** line. Nothing is marked "Implemented" unless it was written, unit-tested, type-checked, and (for the backend) deployed and verified live in this same pass. Decisions marked "Deferred" are exactly that — not silently dropped, not implied to already work.

---

## Why this exists

Cloudflare flagged the Workers KV free-tier daily PUT quota (1,000/day) as exceeded, with live 429s. A prior read-only investigation (same engineering effort, preserved in git history/plan artifacts) found two independent, compounding root causes:

1. `refreshAlertIndex`'s cron (`*/1 * * * *`) wrote to KV **unconditionally every tick** — 1,440 writes/day, alone exceeding the quota with zero app traffic.
2. `checkRateLimit` wrote to KV **once per allowed request**, unbounded, and the write wasn't wrapped — a KV 429 there threw uncaught and surfaced as an HTTP 500 to a public market-data or admin request that had otherwise succeeded.

Separately, the same audit found the existing `MarketStreamRoom` Durable Object — the single shared upstream Twelve Data WebSocket with correct client fan-out and per-symbol reference counting — was architecturally the right foundation to evolve into a full **Market Pool Core** (canonical quote/candle state, alert-driven subscriptions independent of viewers, request coalescing, hot/warm/cold lifecycle), rather than something to replace.

---

## Phase 0 — KV Remediation

### Decision 0.A — Alert index: dirty-check + bounded keepalive, not unconditional writes

**Implemented.** `refreshAlertIndex` (`backend/src/alerts/alert-index.ts`) now:
- Still runs every cron tick (1 min) and still always queries Supabase (a read, not a KV write) — so a genuine alert change is still reflected within a minute, same freshness promise as before.
- Compares the freshly-fetched alert set (serialized) against the currently-cached KV entry. If identical, **skips the KV write entirely**.
- Writes anyway if the cached entry is older than a 5-minute keepalive threshold (`KEEPALIVE_INTERVAL_MS`), so the entry's TTL (now 600s, up from 180s) never lapses even during long unchanged stretches.
- Net effect: writes only on genuine change, or at most once per 5 minutes as a keepalive — from a **guaranteed 1,440/day floor** down to a **bounded ≤288/day ceiling**, typically far less for an early-stage product with few alert changes.

Tested: `backend/test/alert-index.test.ts` — first-write, unchanged-skip, changed-writes-again, keepalive-writes-again, KV-write-failure-does-not-throw. 6/6 passing.

### Decision 0.B — Rate limiting: moved off KV entirely, onto a sharded Durable Object

**Implemented.** `checkRateLimit` (`backend/src/ratelimit.ts`) no longer touches KV at all. It now calls a new `RateLimiterRoom` Durable Object (`backend/src/ratelimit-do.ts`), sharded one instance per rate-limit key (`idFromName(key)`), holding its fixed-window counter **purely in memory** — zero KV writes, zero DO storage writes.

This is strictly an improvement, not just a quota fix: the old KV counter had an eventually-consistent read-then-write race under concurrent requests in the same window; the DO shard is single-threaded, so concurrent requests for the same key are serialized correctly. New wrangler.toml binding `RATE_LIMITER` / migration tag `v2` (additive — `v1`'s `MarketStreamRoom` migration is untouched).

Accepted tradeoff, documented in code: an idle DO instance can be evicted, resetting its counter to zero. This only happens after a period of no traffic from that key (so the client wasn't near the limit anyway) and only makes the limiter *more* permissive after a long gap, never less — never a security-relevant under-limiting bug.

`checkRateLimit` also now fails **open** (allows the request) if the DO call itself throws, rather than propagating — directly closing the "KV 429 → uncaught → 500" incident path from Decision 0.C below, generalized to the DO call too.

Tested: `backend/test/ratelimit.test.ts` (7 tests, including concurrent-same-key and fail-open-on-DO-error) + `backend/test/ratelimit-do.test.ts` (6 direct DO unit tests: window rollover, exhaustion, `resetAt` alignment, sequential-never-loses-an-increment, fresh-instance-after-eviction, malformed-body-safe-400).

### Decision 0.C — Non-essential KV writes degrade instead of throwing

**Implemented.** New `backend/src/kv-safety.ts` exports `safeKvPut`, applied to every KV write that is non-essential (the caller already has the correct value in hand and can proceed without the write landing):
- `cachedFetch`'s cache-population write (`backend/src/cache/cache-service.ts`)
- `putCached`'s batch cache-population write (same file)
- `refreshAlertIndex`'s snapshot write (Decision 0.A)

**Explicitly NOT wrapped**, by design: `config-service.ts`'s `setConfig` — an admin config save is not "non-essential"; the admin needs to see it fail if it fails, so it still throws.

Tested: `backend/test/cache-service.test.ts` — both `cachedFetch` and `putCached` return the correct value/don't throw when the underlying KV write itself throws.

### Decision 0.D — Tests

Delivered: alert-index (6), ratelimit (7), ratelimit-do (6), cache-service additions (5) = **24 new/updated tests** directly covering the Phase 0 requirements list (unchanged→no-write, changed→write, rate-limit normal/concurrency/exhaustion, KV-429-does-not-crash-unrelated-requests, no-recurring-1440/day-pattern via the dirty-check test itself).

### Decision 0.E — Goal

**Met.** KV write paths remaining, exhaustively (unchanged from the audit's inventory, now correctly bounded):

| # | File:Line | Frequency after fix |
|---|---|---|
| 1 | `alert-index.ts` (`refreshAlertIndex`) | On change only, or ≤ once per 5 min (was: every 1 min unconditionally) |
| 2 | `cache-service.ts` (`cachedFetch`) | TTL-bounded, best-effort (failure no longer propagates) |
| 3 | `cache-service.ts` (`putCached`) | Same |
| 4 | `config-service.ts` (`setConfig`) | Manual admin action only, unchanged |

Rate-limit counters (the former #1 by volume) are **no longer a KV write path at all** — moved to `RateLimiterRoom`.

**No Cloudflare paid-tier upgrade was made or recommended as a substitute** — every fix here is an architecture change, per the explicit constraint against hiding the inefficiency behind a higher quota.

---

## Phase 1/2/3 — Market Pool Core, WS Pooling, Alert-First Subscriptions

Implemented together in `backend/src/ws/market-stream-do.ts` (`MarketStreamRoom`) because they share one reference model — splitting them into separate passes would have meant modifying the same ref-counting code three times.

### Decision 1 — MarketStreamRoom becomes the Market Pool Core

**Partially implemented.** Added to the existing, preserved `MarketStreamRoom`:
- ✅ Canonical quote state (`quoteState: Map<symbol, NormalizedTick>`), updated on every tick regardless of who's listening.
- ✅ Reference model: `symbolSubscribers` (viewer refs, pre-existing) + `alertRefCounts` (alert refs, new).
- ✅ Hot/warm-adjacent lifecycle: `hot` (totalRefs > 0) / `idle_grace` (draining) / `cold` (no demand), exposed via `poolStatusSnapshot()`.
- ✅ Idle grace before disconnecting (Decision 2).
- ✅ Reconnect backoff with jitter (Decision 11, folded in here — see below).
- ❌ Canonical **candle** state, quota awareness, priority handling, circuit breaker/failover, stale/gap detection beyond a single `isStale` flag in the status snapshot — **deferred**, see the per-decision entries below.

**A real correctness bug was caught and fixed while wiring this up, not before it existed**: `handleUpstreamMessage` previously returned early (skipping both quote-state recording and `evaluateTick`) whenever there were zero viewer-subscribers for a symbol. Before this pass, that branch was dead code — no symbol was ever upstream-subscribed without a viewer. Once alert-only subscriptions (Decision 3) were wired up, that same early return would have silently made alert-only monitoring a no-op the moment it was exercised. Fixed by moving quote-state recording and the `evaluateTick` call ahead of the viewer-fanout branch, which now only gates the actual `socket.send()` loop.

### Decision 2 — One upstream subscription per symbol, with idle grace

**Implemented**, preserving the pre-existing correct ref-counted fan-out. `IDLE_GRACE_MS = 45_000` (within the specified 30–60s range). A symbol's upstream subscription is only actually dropped when `totalRefs` (viewer + alert) has been zero continuously through one full grace window, checked on the existing 10-second heartbeat tick (`sweepIdleUnsubscribes`) — no new alarm mechanism needed.

Tested directly: 1-client→1-upstream, 100-clients-same-symbol→1-upstream, duplicate-subscribe, idle-grace-not-immediate, sweep-only-after-expiry, resubscribe-cancels-pending-grace. (`backend/test/market-stream-do.test.ts`)

### Decision 3 — Alerts as first-class subscribers, independent of viewers

**Implemented**, deliberately reusing the cron's existing 1-minute cadence rather than inventing a second schedule: right after `refreshAlertIndex` writes (or skips) its KV snapshot, the Worker's `scheduled` handler now also calls `triggerAlertRefSync(env)`, which POSTs to the single `MarketStreamRoom` instance's new internal `/sync-alert-refs` route. That route calls `syncAlertRefs()`, which **reads** (never writes) the same KV alert index and diffs it against the DO's in-memory `alertRefCounts`:
- A symbol going from 0→N alert refs immediately triggers `ensureUpstreamSubscribedForMkrSymbol` — this is what lets a newly-created alert start being monitored with **zero Flutter clients connected**, satisfying the exact "user creates alert, closes app, alert keeps working" requirement.
- A symbol going from N→0 alert refs schedules idle grace exactly like a viewer leaving.
- **Supabase is never queried per tick** — this sync only ever reads the already-cron-refreshed KV snapshot, same boundary as before.

Both internal DO routes (`/sync-alert-refs`, `/pool-status`) are unreachable from the public internet: the existing public `/api/mkr/market/stream` route rejects any non-WebSocket-upgrade request *before* it ever forwards to the DO (see `ws-routes.ts`, unchanged), so only server-side code holding the `MARKET_STREAM` binding directly (the cron trigger, the new admin route) can reach them.

Tested: alert-only symbol gets subscribed with zero viewers; last-viewer-leaving does NOT trigger idle grace while an alert ref remains (the headline Decision 3 scenario); removing the last alert ref does schedule and execute idle grace; `alertRefCounts` tracks the actual count of enabled alerts per symbol, not just presence.

**Operational note on the Supabase Auth Admin API 401** (from the prior session): unaffected by and unrelated to this work — `refreshAlertIndex` uses `supabaseSelect` (`/rest/v1/...`, PostgREST), not the Auth Admin API (`/auth/v1/admin/...`) that was reported failing. Alert-index refresh and the new alert-ref sync built on it do not depend on that operational blocker being resolved.

### Decision 4 — Server-side candle aggregation

**Deferred — not implemented in this pass.** Correctly implementing all 8 timeframes with duplicate/out-of-order tick handling, session-boundary awareness, and provider-historical reconciliation is a substantial, independently-testable unit of work. Building it hastily inside an already-large pass risked either an untested aggregation engine reaching production, or claiming test coverage that wasn't real — both worse than deferring explicitly. **Recommended as the next focused one-shot**, scoped to just this decision plus Decision 17 (protocol versioning) together, since they're tightly coupled.

### Decision 5 — Market Pool as canonical live state feeding every consumer from one tick

**Partially implemented.** The bug fix under Decision 1 (quote state + alert evaluation both now fed from the same tick, unconditionally) is exactly this decision's core mechanism for the two consumers that exist today (Flutter fan-out, Alert Engine). Extending it to candle state (Decision 4) and observability counters (Decision 20) is deferred with those decisions.

### Decision 6 — L1/L2/L3 cache layers

**Partially implemented / pre-existing.** L2 (Market Pool DO canonical state) is what Decisions 1/5 add. L1 (Worker in-memory) and the single-flight layer already existed (`cache-service.ts`'s `inFlight` map) and is strengthened by Decision 7 below. L3 (Cloudflare Edge Cache API for historical GET acceleration) is **deferred** — not yet wired to `handleCandles`.

### Decision 7 — Request coalescing (Phase 5)

**Implemented.** `handleQuotes` (`backend/src/market/market-routes.ts`) previously read/wrote the KV cache directly via `getCached`/`putCached`, bypassing `cachedFetch`'s in-flight single-flight map entirely — confirmed by the prior audit as the one concrete verified gap. Fixed by wrapping the batch provider call in a new general-purpose `coalesced()` primitive (`cache-service.ts`), keyed by the exact sorted uncached-symbol set, sharing the same per-isolate `inFlight` map `cachedFetch` already uses. Concurrent batch requests landing on the identical uncached-symbol set now share one upstream call.

Tested: `coalesced()` directly (concurrent-same-key-shares-one-call, different-keys-never-coalesce, sequential-calls-run-independently) — `backend/test/cache-service.test.ts`. A full `handleQuotes`-level integration test was not added: that handler has no existing test harness (no fake D1 symbol catalog / provider manager fixtures exist yet for it), and building one from scratch was judged out of scope for this pass versus testing the actual fixed primitive directly.

### Decisions 8–10, 12–27 (Hot/Warm/Cold beyond lifecycle labeling, Quota Manager, Session Awareness, Circuit Breaker/Failover, sharding by domain, Admin/Observability beyond the new pool-status endpoint, Flutter migration, and the remainder of the Phase 13 test matrix)

**Deferred — not implemented in this pass**, tracked here explicitly rather than silently:
- Decision 8 (Hot/Warm/Cold): the `hot`/`idle_grace`/`cold` labels exist (Decision 1) but there is no separate "warm" tier with its own background-refresh policy yet — today it's effectively binary (has-refs vs. draining-or-not).
- Decision 9 (centralized TTL policy table): TTLs remain where they were (config-service defaults + per-symbol D1 override) — not wrong, just not yet centralized into the exact table the ADR audit specified.
- Decision 10 (stale/gap detection): `poolStatusSnapshot()` exposes a per-symbol `isStale` boolean (age vs. `STALE_THRESHOLD_SECONDS`), but no `LIVE/STALE/DEGRADED/OFFLINE` state machine or gap detection.
- Decision 11 (circuit breaker/failover/backoff): reconnect backoff **with jitter** is implemented (this pass, `scheduleReconnect`); circuit-breaker state machine and Alpaca failover are not.
- Decision 12 (quota manager, P0–P4 priority): not implemented.
- Decision 13 (session awareness): not implemented.
- Decision 14 (search debounce): out of scope — client-side, Flutter.
- Decisions 15–16 (negative caching, versioned cache keys): not implemented; current cache keys are unversioned.
- Decision 17 (WS protocol versioning): not implemented — moot until Decision 4 ships and needs it.
- Decision 18 (Alert Engine consumes canonical state): the Alert Engine already evaluates the tick in-hand (pre-existing, confirmed by the original audit) and now definitely fires for alert-only symbols too (the Decision 1 bug fix) — no duplicate provider fetch path exists or was added.
- Decision 19 (Supabase outside hot tick path): already true, unaffected by this pass.
- Decision 20 (observability counters): `poolStatusSnapshot()` is a start (Decision 21) but the specific named counters (`cache_hit`, `provider_429`, `circuit_open`, etc.) are not implemented.
- Decision 21 (Admin exposes pool metrics): **partially implemented** — new `GET /api/mkr/admin/market-pool` route (`index.ts`, gated by the existing `requireAdmin`) returns `poolStatusSnapshot()`. No Admin Web UI page consumes it yet.
- Decision 22 (no global singleton DO / domain sharding): **not changed** — still one global room, as before. Explicitly not a problem yet per the original audit ("do not over-shard prematurely"); revisit only if a real symbol-count ceiling is hit.
- Decisions 23–24 (DO storage discipline, Edge Cache for historical GET): unaffected/not implemented respectively.
- Decisions 25–26 (correctness over cost/hit-rate): a design principle honored throughout this pass, not a discrete deliverable.
- Decision 27 (DO tests mandatory before production deployment): **the gate this pass treats as binding** — see Testing below.

---

## Testing

New test files: `market-stream-do.test.ts` (20), `ratelimit-do.test.ts` (6), `ratelimit.test.ts` rewritten (7), `alert-index.test.ts` (6). Updated: `cache-service.test.ts` (+5), two `Env`-literal test fixtures updated for the new `RATE_LIMITER` binding.

**Full suite: 141/141 passing. `tsc --noEmit`: clean.** Both verified by actually running them in this pass, not assumed.

Direct DO coverage (Decision 27) exercises: viewer ref counting (1-client, 100-clients-same-symbol, duplicate-subscribe, unknown-symbol-skipped), idle grace (schedule/sweep/cancel-on-resubscribe), alert refs (alert-only subscription, combined-refs-block-idle-grace, ref-removal-triggers-grace, multi-alert-count), canonical quote state (alert-only tick recording, malformed-frame-safety), pool-status snapshot lifecycle labeling, reconnect backoff/jitter bounds, and the heartbeat/sweep/reschedule alarm cycle.

Not covered directly (see Deferred decisions above for why): candle aggregation (doesn't exist yet), circuit breaker/failover, quota-priority budget levels, session-awareness, and `handleQuotes`-level integration (covered instead at the `coalesced()` unit level — see Decision 7).

---

## Deployment

Backend Worker deployed after the full test/typecheck/security-scan pass above; see the session's final report for the exact version ID and live verification steps performed. Admin Web was **not** redeployed in this pass (no Admin Web source changed — the new `/api/mkr/admin/market-pool` route has no UI consumer yet).

Cloudflare resources changed: one new Durable Object class (`RateLimiterRoom`, additive migration tag `v2`) and one new binding (`RATE_LIMITER`) in `wrangler.toml`. `MarketStreamRoom`'s existing `v1` migration is untouched. No KV namespace, D1 database, or Cron Trigger schedule was added, removed, or renamed.

---

## Recommended next one-shot prompts

In priority order, each scoped tightly enough to get real test coverage rather than a repeat of "implement everything":

1. **Server-side candle aggregation** (Decision 4) + WS protocol versioning (Decision 17) — the two most architecturally central remaining pieces, and the ones Flutter migration (Decision 12/Phase 12) depends on.
2. **Circuit breaker + Alpaca failover** (Decision 11's remainder) — currently Twelve Data has no automatic failover path at all if it degrades, only reconnect-with-backoff for transport drops.
3. **Quota manager + priority budgeting** (Decision 12) — becomes load-bearing once real user traffic exists; premature before then.
4. **Admin Web UI for the new `/api/mkr/admin/market-pool` endpoint** — the backend data already exists (this pass); this is a smaller, mostly-frontend follow-up.
