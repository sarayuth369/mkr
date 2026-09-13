-- MKR (Market Radar) — Supabase user-data schema, Phase 2.2/2.3 foundation.
--
-- Scope boundary: this database holds USER-OWNED data only (auth, profile,
-- watchlist, alerts, devices, notification history, preferences,
-- subscription state). Market price data stays entirely on the Cloudflare
-- Worker (D1/KV/Durable Object, see backend/schema.sql) — Supabase is never
-- used for market price streaming, per the architecture decision recorded
-- in docs/MKR-PHASE2-ARCHITECTURE.md.
--
-- Apply with the Supabase CLI once a project exists:
--   supabase link --project-ref <your-project-ref>
--   supabase db push
-- or paste this file into the Supabase SQL editor for a one-off project.

-- ── profiles ────────────────────────────────────────────────────────────
-- One row per authenticated user, keyed 1:1 to auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'ai_pro', 'lifetime')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── devices ─────────────────────────────────────────────────────────────
-- FCM push tokens. One user may have several devices; a token is
-- deactivated (not deleted) on logout/refresh so notification history
-- referencing it stays valid.
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fcm_token text not null,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  app_version text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, fcm_token)
);

-- ── watchlists / watchlist_items ────────────────────────────────────────
-- A user may have multiple named watchlists later; Phase 2 UI only ever
-- creates/uses one ("default") per user, matching the existing single-list
-- Flutter WatchlistController.
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'default',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists (id) on delete cascade,
  symbol text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);

-- ── alerts ──────────────────────────────────────────────────────────────
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Flutter's local alert id (see lib/features/alerts/domain/alert.dart) —
  -- lets the client upsert idempotently instead of re-inserting a new cloud
  -- row every time a locally-known alert is re-synced.
  client_id text,
  symbol text not null,
  condition_type text not null check (condition_type in ('price_above', 'price_below')),
  target_value numeric not null check (target_value > 0),
  secondary_value numeric,
  enabled boolean not null default true,
  cooldown_seconds integer not null default 3600 check (cooldown_seconds >= 0),
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists idx_alerts_enabled_symbol on public.alerts (symbol) where enabled;

-- ── notification_logs ───────────────────────────────────────────────────
create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  alert_id uuid references public.alerts (id) on delete set null,
  device_id uuid references public.devices (id) on delete set null,
  title text not null,
  body text not null,
  status text not null check (status in ('sent', 'failed')),
  provider text not null default 'fcm',
  sent_at timestamptz not null default now(),
  error_message text
);

create index if not exists idx_notification_logs_user on public.notification_logs (user_id, sent_at desc);

-- ── preferences ─────────────────────────────────────────────────────────
create table if not exists public.preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'th')),
  currency text not null default 'USD' check (currency in ('USD', 'THB')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  notification_enabled boolean not null default true,
  alert_push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── subscriptions ───────────────────────────────────────────────────────
-- Provider-agnostic subscription state (spec 2.4-F) - Google Play Billing
-- is the intended future `provider` value; this table only records status,
-- it never performs real billing.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('free', 'pro', 'ai_pro', 'lifetime')),
  provider text not null default 'none' check (provider in ('none', 'google_play')),
  product_id text,
  status text not null default 'inactive' check (status in ('inactive', 'active', 'expired', 'cancelled')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on public.subscriptions (user_id);

-- ── updated_at maintenance ──────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_alerts_updated_at on public.alerts;
create trigger trg_alerts_updated_at before update on public.alerts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_preferences_updated_at on public.preferences;
create trigger trg_preferences_updated_at before update on public.preferences
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── auto-create profile + default watchlist + preferences on signup ─────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1));
  insert into public.watchlists (user_id, name) values (new.id, 'default');
  insert into public.preferences (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
