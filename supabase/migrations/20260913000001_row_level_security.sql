-- MKR Row Level Security — every table a user can reach directly is locked
-- to rows they own. Service-role operations (used only by the Cloudflare
-- backend's alert engine / admin routes, never by Flutter) bypass RLS by
-- design — the service-role key must never reach Flutter (see
-- docs/MKR-EXTERNAL-INTEGRATIONS.md).

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.alerts enable row level security;
alter table public.notification_logs enable row level security;
alter table public.preferences enable row level security;
alter table public.subscriptions enable row level security;

-- profiles: a user may read/update only their own row (insert happens via
-- the handle_new_user() trigger, running as security definer).
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);

-- devices: full CRUD on the caller's own device rows only.
create policy devices_all_own on public.devices for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- watchlists: full CRUD on the caller's own watchlists only.
create policy watchlists_all_own on public.watchlists for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- watchlist_items: ownership is via the parent watchlist's user_id.
create policy watchlist_items_all_own on public.watchlist_items for all
  using (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid()))
  with check (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));

-- alerts: full CRUD on the caller's own alerts only.
create policy alerts_all_own on public.alerts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notification_logs: read-only for the owning user (written by the backend
-- via the service-role key, never directly by Flutter).
create policy notification_logs_select_own on public.notification_logs for select using (auth.uid() = user_id);

-- preferences: full CRUD on the caller's own row only.
create policy preferences_all_own on public.preferences for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- subscriptions: read-only for the owning user (written by the backend
-- once a real billing provider exists — never directly by Flutter).
create policy subscriptions_select_own on public.subscriptions for select using (auth.uid() = user_id);
