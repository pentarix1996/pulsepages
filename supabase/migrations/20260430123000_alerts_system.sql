-- ==========================================
-- Migration: Alerts System
-- ==========================================
-- Durable project alert settings, channel configs, events, deliveries and cooldowns.

create table if not exists public.project_alert_configs (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null unique,
  enabled boolean default false not null,
  cooldown_minutes integer default 30 not null check (cooldown_minutes between 0 and 1440),
  notify_recovery boolean default true not null,
  alert_types jsonb default '{"component_status":true,"monitor_failure":true,"incident_created":true,"incident_updated":true,"incident_resolved":true}'::jsonb not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.alert_channel_configs (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  type text not null check (type in ('email')),
  enabled boolean default false not null,
  config jsonb default '{"recipients":[],"template_variant":"default"}'::jsonb not null,
  verified_at timestamptz,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  unique(project_id, type)
);

create table if not exists public.alert_events (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  type text not null check (type in ('component_status_worsened','component_recovered','monitor_check_failed','monitor_check_recovered','incident_created','incident_updated','incident_resolved','test')),
  source_type text not null check (source_type in ('manual','incident','monitor_next_api','monitor_edge_runner','external_api','test')),
  source_id text,
  status text default 'pending' not null check (status in ('pending','processed','suppressed','failed')),
  severity text,
  dedupe_key text not null,
  payload jsonb not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  processed_at timestamptz
);

create table if not exists public.alert_deliveries (
  id uuid default gen_random_uuid() primary key,
  event_id uuid references public.alert_events(id) on delete cascade not null,
  channel_config_id uuid references public.alert_channel_configs(id) on delete cascade not null,
  target text not null,
  status text default 'pending' not null check (status in ('pending','processing','sent','retryable','failed','suppressed')),
  attempts integer default 0 not null check (attempts >= 0),
  next_retry_at timestamptz,
  provider text,
  provider_message_id text,
  idempotency_key text not null unique,
  error_code text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.alert_cooldowns (
  project_id uuid references public.projects(id) on delete cascade not null,
  channel_type text not null check (channel_type in ('email')),
  dedupe_key text not null,
  last_sent_at timestamptz not null,
  last_event_id uuid references public.alert_events(id) on delete set null,
  primary key(project_id, channel_type, dedupe_key)
);

create index if not exists project_alert_configs_project_id_idx on public.project_alert_configs(project_id);
create index if not exists alert_channel_configs_project_type_idx on public.alert_channel_configs(project_id, type);
create index if not exists alert_events_status_created_idx on public.alert_events(status, created_at);
create index if not exists alert_events_project_created_idx on public.alert_events(project_id, created_at desc);
create index if not exists alert_events_project_dedupe_idx on public.alert_events(project_id, dedupe_key, created_at desc);
create index if not exists alert_deliveries_event_idx on public.alert_deliveries(event_id);
create index if not exists alert_deliveries_due_idx on public.alert_deliveries(status, next_retry_at) where status in ('pending', 'retryable');
create index if not exists alert_deliveries_channel_created_idx on public.alert_deliveries(channel_config_id, created_at desc);

alter table public.project_alert_configs enable row level security;
alter table public.alert_channel_configs enable row level security;
alter table public.alert_events enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.alert_cooldowns enable row level security;

drop policy if exists "Owners manage project alert configs" on public.project_alert_configs;
create policy "Owners manage project alert configs" on public.project_alert_configs
for all using (
  exists (select 1 from public.projects where projects.id = project_alert_configs.project_id and projects.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects where projects.id = project_alert_configs.project_id and projects.user_id = auth.uid())
);

drop policy if exists "Owners manage alert channel configs" on public.alert_channel_configs;
create policy "Owners manage alert channel configs" on public.alert_channel_configs
for all using (
  exists (select 1 from public.projects where projects.id = alert_channel_configs.project_id and projects.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects where projects.id = alert_channel_configs.project_id and projects.user_id = auth.uid())
);

drop policy if exists "Owners read alert events" on public.alert_events;
create policy "Owners read alert events" on public.alert_events
for select using (
  exists (select 1 from public.projects where projects.id = alert_events.project_id and projects.user_id = auth.uid())
);

drop policy if exists "Owners read alert deliveries" on public.alert_deliveries;
create policy "Owners read alert deliveries" on public.alert_deliveries
for select using (
  exists (
    select 1 from public.alert_events
    join public.projects on projects.id = alert_events.project_id
    where alert_events.id = alert_deliveries.event_id and projects.user_id = auth.uid()
  )
);

create or replace function public.touch_alert_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists touch_project_alert_configs_updated_at on public.project_alert_configs;
create trigger touch_project_alert_configs_updated_at before update on public.project_alert_configs
for each row execute procedure public.touch_alert_updated_at();

drop trigger if exists touch_alert_channel_configs_updated_at on public.alert_channel_configs;
create trigger touch_alert_channel_configs_updated_at before update on public.alert_channel_configs
for each row execute procedure public.touch_alert_updated_at();

drop trigger if exists touch_alert_deliveries_updated_at on public.alert_deliveries;
create trigger touch_alert_deliveries_updated_at before update on public.alert_deliveries
for each row execute procedure public.touch_alert_updated_at();

-- Optional cron setup can invoke /api/alerts/worker or a future Edge alert-worker.
-- Store ALERT_WORKER_SECRET outside the database; do not hardcode secrets in cron SQL.
