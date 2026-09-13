# MKR External Integrations — what the product owner must supply

This document lists every external credential MKR's Phase 2.2–2.4 code is
**ready to use but does not have**, exactly what to create, and exactly
where to put each value. Nothing described below was fabricated, guessed,
or partially wired — every integration point already exists in code behind
a clean interface and fails safely (never crashes, never fakes success,
never shows fabricated data) until these are supplied.

## Summary table

| Integration | Used for | Client-safe? | Where it goes |
|---|---|---|---|
| Supabase project URL | Auth, watchlist/alert sync, devices | Yes | Flutter `--dart-define=SUPABASE_URL=...` **and** `backend/.dev.vars`/`wrangler secret put SUPABASE_URL` |
| Supabase anon/publishable key | Auth, watchlist/alert sync | Yes | Flutter `--dart-define=SUPABASE_ANON_KEY=...` |
| Supabase service-role key | Alert Engine, Admin Users/Alerts/Push/Subscriptions | **No — backend only** | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` — never in Flutter |
| Firebase project + service account | Push notifications (FCM) | **No — backend only** | `wrangler secret put FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY` |
| `google-services.json` | Push notifications (Android FCM client) | N/A (native config file) | `android/app/google-services.json` (not committed) |
| Google Play Billing | Real subscriptions | — | **Not built this phase** — see below |

## 1. Supabase

### 1.1 Create the project (if one doesn't already exist for MKR)

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Name it something MKR-specific (e.g. `mkr-market-radar`) — this code
   never assumes a project ID and was never pointed at an existing,
   unrelated Supabase project.
3. Choose a region close to your primary user base.
4. Wait for provisioning (a couple of minutes).

### 1.2 Apply the schema

Two migration files already exist in this repo:

```
supabase/migrations/20260913000000_initial_schema.sql
supabase/migrations/20260913000001_row_level_security.sql
```

Apply them via the Supabase CLI (`supabase link` then
`supabase db push`) or paste each file's contents into the Supabase
Dashboard's SQL Editor and run them in order. This creates:
`profiles`, `devices`, `watchlists`, `watchlist_items`, `alerts`,
`notification_logs`, `preferences`, `subscriptions` — with Row Level
Security enabled and a trigger that auto-provisions a profile/default
watchlist/preferences row whenever a new `auth.users` row is created.

### 1.3 Get the three values

In the Supabase Dashboard → Project Settings → API:

- **Project URL** → `SUPABASE_URL`
- **`anon` `public` key** → `SUPABASE_ANON_KEY` (Flutter) — safe to embed in
  a client build; Row Level Security is what actually protects data, not
  secrecy of this key.
- **`service_role` key** → `SUPABASE_SERVICE_ROLE_KEY` (backend only) —
  this bypasses Row Level Security entirely. Treat it like a database
  root password. **Never** put it in a `--dart-define`, a Flutter file, a
  commit, or a client-visible response.

### 1.4 Wire it up

```bash
# Backend (Cloudflare Worker)
cd backend
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Flutter build
flutter build apk \
  --dart-define=SUPABASE_URL=https://<project>.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=<anon-key>
```

### 1.5 What turns on once this is done

- Real Register/Login/Logout/session-restore replace the mock auth path
  (`SupabaseAuthService` — see `lib/features/auth/data/supabase_auth_service.dart`).
- Watchlist and price-alert sync to the cloud (merge-once-per-user on
  first login, then live sync — `SupabaseWatchlistRepository`,
  `SupabaseAlertCloudSync`).
- The Alert Engine's Cron Trigger starts actually finding alerts to
  evaluate (`refreshAlertIndex` — previously a no-op returning `null`).
- Admin Web's Users / Alerts / Notification Logs / Subscriptions pages
  switch from "not configured" to real data.
- Nothing about market data (quotes/candles/WebSocket) changes — that
  stays entirely on the Cloudflare/Twelve Data path, unaffected.

Flip `alertsEnabled`/`watchlistSyncEnabled`/`userAuthEnabled` on in Admin
Web → Feature Flags once you've verified the above (they default to `false`
so a fresh deploy with just the Supabase secrets configured doesn't
silently start evaluating alerts with cooldown/dedup logic you haven't
smoke-tested yet).

## 2. Firebase Cloud Messaging (push transport)

FCM is **transport only** — it never becomes MKR's user database. Supabase
remains the source of truth for who a device belongs to.

### 2.1 Create the Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com) → Add
   project (or reuse an existing one if the product owner already has one
   intended for MKR — do not reuse an unrelated app's Firebase project).
2. Add an Android app with package name `com.mlabs.mkr` (must match
   `android/app/build.gradle`'s `applicationId` exactly).
3. Download the generated `google-services.json` and place it at
   `android/app/google-services.json`. **Do not commit this file** — it's
   already in `.gitignore`.

### 2.2 Generate a service account (for the backend)

1. Firebase Console → Project Settings → Service Accounts → Generate new
   private key. This downloads a JSON file with `project_id`,
   `client_email`, and `private_key`.
2. Set the three backend secrets from that file's fields:

```bash
cd backend
wrangler secret put FCM_PROJECT_ID       # the JSON's "project_id"
wrangler secret put FCM_CLIENT_EMAIL     # the JSON's "client_email"
wrangler secret put FCM_PRIVATE_KEY      # the JSON's "private_key" (keep the \n line breaks)
```

Delete the downloaded JSON file once the three values are in Wrangler
secrets — it should not live on disk longer than necessary, and must never
be committed.

### 2.3 What turns on once this is done (backend side)

`getPushProvider(env)` (`backend/src/push/provider-factory.ts`) starts
returning a real `FcmPushProvider` instead of `DisabledPushProvider`. The
Alert Engine's `triggerAlert` and Admin Web's Push page (test send /
announcement) start actually delivering pushes — still gated by the
`pushNotificationsEnabled` feature flag, which defaults to `false`.

### 2.4 What is intentionally NOT done on the Flutter side yet

`lib/features/push/domain/push_notification_service.dart` and
`device_repository.dart` are fully-designed interfaces with a `Noop*`
implementation wired into the app today
(`lib/features/push/data/noop_push_notification_service.dart`). No
`firebase_messaging` package has been added to `pubspec.yaml` — doing so
requires native Android Gradle changes (Google Services plugin) that would
be unsafe to make without `google-services.json` actually present, and
could break the build for every developer who doesn't have it yet.

**To finish this integration once `google-services.json` exists:**

1. Add `firebase_core` and `firebase_messaging` to `pubspec.yaml`.
2. Add the Google Services Gradle plugin per
   [Firebase's official Flutter setup guide](https://firebase.google.com/docs/flutter/setup) —
   at time of writing this is `id "com.google.gms.google-services"` in
   `android/app/build.gradle` plus the classpath in the project-level
   `android/build.gradle`.
3. Implement `FirebaseMessagingPushService implements PushNotificationService`
   in `lib/features/push/data/`, calling `FirebaseMessaging.instance`'s
   real APIs for each of the interface's methods (`getToken()`,
   `requestPermission()`, the two message streams).
4. Swap the `Provider<PushNotificationService>` registration in
   `lib/app/app.dart` from `NoopPushNotificationService` to the new class
   (mirroring exactly how `SupabaseConfig.instance.isConfigured` already
   branches `AuthService`/`WatchlistRepository` — a Firebase-configured
   check should branch this the same way, e.g. checking that
   `google-services.json` produced a non-empty `Firebase.apps` list at
   startup).

No other call site needs to change — `AuthController` already calls
`registerDevice()`/`deactivateDevice()` around login/logout against
whatever `PushNotificationService`/`DeviceRepository` are registered.

## 3. Google Cloud

No separate Google Cloud project/API is required beyond what Firebase
already provisions for FCM (Firebase IS a Google Cloud product — the
service account above is a standard Google Cloud IAM service account). No
other Google Cloud API is used by this codebase.

## 4. Google Play Billing (explicitly deferred)

The spec is explicit: **do not implement real Google Play Billing this
phase.** `backend`'s `subscriptions` table and Admin Web's Subscriptions
page model a provider-agnostic shape (`product_id`/`provider`/`status`/
`expires_at`) so a real billing integration can populate real rows later
without a schema change, but no `in_app_purchase`/Play Billing client code
exists yet on the Flutter side (the existing `BillingRepository` remains
`MockBillingRepository`, unchanged from Phase 1). Building this is a
separate, focused piece of future work — implementing it partially now
would risk a broken/rejected Play Store submission for no benefit until
the product is otherwise ready to charge real users.

## 5. Verifying each integration without any live traffic

Every integration above has an automated test that runs with **no real
credential** and asserts the honest "not configured" behavior:

- `backend/test/supabase-client.test.ts` — `supabaseConfigFrom` returns
  `null` without both Supabase values; `refreshAlertIndex` returns `null`.
- `backend/test/alert-engine.test.ts` — pure condition/cooldown logic,
  no network at all.
- `backend/test/push-provider-factory.test.ts` — `getPushProvider` returns
  `DisabledPushProvider` unless all three FCM secrets are present; a
  disabled provider's `send()` always reports `success: false`.
- `test/logic/auth_controller_device_registration_test.dart` (Flutter) —
  device registration only fires for a real (non-guest) session with a
  granted permission and a non-null token; a guest session never triggers
  it.

Running `npm test` (backend) and `flutter test` (Flutter) after adding real
credentials is the fastest way to confirm nothing regressed — none of these
tests need to be rewritten once credentials exist, since they test the
*absence* path deliberately and separately from any live-integration smoke
test you'd run manually against a real Supabase/Firebase project.
