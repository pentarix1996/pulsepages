-- ==========================================
-- Migration: Automatic Monitoring Pingers
-- ==========================================
-- Adds per-component monitoring configuration, check results, history reasons,
-- and server-side plan/interval enforcement for Supabase Cron + Edge Function MVP.

-- Extend component_status_history.reason CHECK constraints conservatively.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'component_status_history'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%reason%'
  loop
    execute format('alter table public.component_status_history drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.component_status_history
add constraint component_status_history_reason_check
check (reason in ('incident', 'manual', 'maintenance', 'incident_resolved', 'monitor', 'monitor_recovery'));

create table if not exists public.component_monitor_configs (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  component_id uuid references public.components(id) on delete cascade not null unique,
  mode text default 'manual'::text not null check (mode in ('manual', 'automatic')),
  enabled boolean default false not null,
  url text,
  method text default 'GET'::text not null check (method in ('GET', 'HEAD')),
  interval_seconds integer default 60 not null check (interval_seconds >= 60),
  timeout_ms integer default 5000 not null check (timeout_ms between 1000 and 10000),
  expected_status_codes integer[] default array[200]::integer[] not null,
  response_type text default 'none'::text not null check (response_type in ('none', 'json')),
  json_rules jsonb default '[]'::jsonb not null,
  failure_status text default 'major_outage'::text not null check (failure_status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  no_match_status text default 'degraded'::text not null check (no_match_status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  last_checked_at timestamptz,
  next_check_at timestamptz default timezone('utc'::text, now()) not null,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  constraint automatic_monitor_requires_url check (mode = 'manual' or url is not null),
  constraint manual_monitor_disabled check (mode = 'automatic' or enabled = false)
);

create index if not exists component_monitor_configs_project_id_idx on public.component_monitor_configs(project_id);
create index if not exists component_monitor_configs_due_idx on public.component_monitor_configs(next_check_at) where mode = 'automatic' and enabled = true;

create table if not exists public.monitor_check_results (
  id uuid default gen_random_uuid() primary key,
  config_id uuid references public.component_monitor_configs(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  component_id uuid references public.components(id) on delete cascade not null,
  status text not null check (status in ('success', 'failure')),
  resulting_status text check (resulting_status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  error_message text,
  checked_at timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists monitor_check_results_project_checked_idx on public.monitor_check_results(project_id, checked_at desc);
create index if not exists monitor_check_results_component_checked_idx on public.monitor_check_results(component_id, checked_at desc);

alter table public.component_monitor_configs enable row level security;
alter table public.monitor_check_results enable row level security;

drop policy if exists "Owners manage monitor configs" on public.component_monitor_configs;
create policy "Owners manage monitor configs" on public.component_monitor_configs
for all using (
  exists (select 1 from public.projects where projects.id = component_monitor_configs.project_id and projects.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects where projects.id = component_monitor_configs.project_id and projects.user_id = auth.uid())
);

drop policy if exists "Owners read monitor check results" on public.monitor_check_results;
create policy "Owners read monitor check results" on public.monitor_check_results
for select using (
  exists (select 1 from public.projects where projects.id = monitor_check_results.project_id and projects.user_id = auth.uid())
);

drop policy if exists "Owners insert monitor check results" on public.monitor_check_results;
create policy "Owners insert monitor check results" on public.monitor_check_results
for insert with check (
  exists (select 1 from public.projects where projects.id = monitor_check_results.project_id and projects.user_id = auth.uid())
);

create or replace function public.enforce_monitor_config_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  owner_plan text;
  component_project uuid;
begin
  select c.project_id into component_project
  from public.components c
  where c.id = new.component_id;

  if component_project is null or component_project <> new.project_id then
    raise exception 'Monitor component must belong to the selected project.';
  end if;

  select coalesce(pr.plan, 'free') into owner_plan
  from public.projects p
  join public.profiles pr on pr.id = p.user_id
  where p.id = new.project_id;

  if new.mode = 'automatic' and owner_plan not in ('pro', 'business') then
    raise exception 'Automatic monitoring requires Pro or Business.';
  end if;

  if new.interval_seconds < 60 then
    new.interval_seconds := 60;
  end if;

  if new.timeout_ms > 10000 then
    new.timeout_ms := 10000;
  end if;

  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists enforce_monitor_config_rules_trigger on public.component_monitor_configs;
create trigger enforce_monitor_config_rules_trigger
before insert or update on public.component_monitor_configs
for each row execute procedure public.enforce_monitor_config_rules();

-- Best-effort Supabase Cron setup for one global monitor runner every minute.
-- This intentionally does not hardcode a project ref or secret. To make the job fully
-- executable, store these Vault secrets before applying/rerunning this section:
--   SUPABASE_URL            = https://<project-ref>.supabase.co
--   MONITOR_RUNNER_SECRET   = same value configured on the Edge Function
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron extension is not available; schedule monitor-runner manually with supabase/functions/monitor-runner/README.md';
  end;

  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net extension is not available; schedule monitor-runner manually with supabase/functions/monitor-runner/README.md';
  end;

  begin
    create extension if not exists supabase_vault with schema vault;
  exception when others then
    raise notice 'supabase_vault extension is not available; create Vault secrets and schedule monitor-runner manually';
  end;
end $$;

do $$
declare
  has_cron boolean := to_regnamespace('cron') is not null;
  has_net boolean := to_regnamespace('net') is not null;
  has_vault boolean := to_regclass('vault.decrypted_secrets') is not null;
  has_supabase_url boolean := false;
  has_runner_secret boolean := false;
begin
  if has_vault then
    select exists(select 1 from vault.decrypted_secrets where name = 'SUPABASE_URL') into has_supabase_url;
    select exists(select 1 from vault.decrypted_secrets where name = 'MONITOR_RUNNER_SECRET') into has_runner_secret;
  end if;

  if has_cron and has_net and has_vault and has_supabase_url and has_runner_secret then
    if exists(select 1 from cron.job where jobname = 'monitor-runner-every-30-seconds') then
      perform cron.unschedule('monitor-runner-every-30-seconds');
    end if;

    if exists(select 1 from cron.job where jobname = 'monitor-runner-every-minute') then
      perform cron.unschedule('monitor-runner-every-minute');
    end if;

    perform cron.schedule(
      'monitor-runner-every-minute',
      '* * * * *',
      $job$
      select net.http_post(
        url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL'), '/') || '/functions/v1/monitor-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'MONITOR_RUNNER_SECRET')
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  else
    raise notice 'monitor-runner cron not scheduled. Requirements: pg_cron %, pg_net %, vault %, SUPABASE_URL secret %, MONITOR_RUNNER_SECRET secret %', has_cron, has_net, has_vault, has_supabase_url, has_runner_secret;
  end if;
end $$;
