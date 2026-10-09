-- ==========================================
-- Migration: v2 monitors (multi-region, confirmation, heartbeats) and external signals
-- ==========================================
-- Monitors are decoupled from components (N:M). Results are evaluated per region by the Edge runner and persisted
-- with record_monitor_run(); a monitor only changes state after confirmation, which avoids false positives (1.2).

create or replace function public.monitor_regions()
returns text[]
language sql
immutable
as $$
  select array[
    'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-2',
    'us-east-1', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
    'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1'
  ]::text[]
$$;

create table if not exists public.monitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  type text not null check (type in ('http', 'keyword', 'tcp', 'dns', 'tls', 'heartbeat')),
  enabled boolean not null default true,
  paused_reason text,
  interval_seconds integer not null default 180 check (interval_seconds between 30 and 86400),
  timeout_ms integer not null default 10000 check (timeout_ms between 1000 and 30000),
  regions text[] not null default array['eu-central-1']::text[],
  confirm_failures integer not null default 2 check (confirm_failures between 1 and 10),
  confirm_regions integer not null default 1 check (confirm_regions between 1 and 15),
  recovery_successes integer not null default 2 check (recovery_successes between 1 and 10),
  config jsonb not null default '{}'::jsonb,
  failure_status text not null default 'major_outage' check (failure_status in ('degraded', 'partial_outage', 'major_outage')),
  degraded_status text not null default 'degraded' check (degraded_status in ('degraded', 'partial_outage', 'major_outage')),
  state text not null default 'pending' check (state in ('pending', 'up', 'degraded', 'down', 'paused')),
  state_changed_at timestamptz,
  last_checked_at timestamptz,
  last_claimed_at timestamptz,
  next_check_at timestamptz not null default now(),
  last_result jsonb,
  last_error text,
  heartbeat_token text unique,
  last_heartbeat_at timestamptz,
  tls_expires_at timestamptz,
  tls_checked_at timestamptz,
  tls_warned_at timestamptz,
  auto_draft_incident boolean not null default true,
  legacy_config_id uuid unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(regions) >= 1 and regions <@ public.monitor_regions())
);

create index if not exists monitors_project_idx on public.monitors (project_id, created_at);
create index if not exists monitors_due_idx on public.monitors (next_check_at)
  where enabled and paused_reason is null and type <> 'heartbeat';
create index if not exists monitors_heartbeat_idx on public.monitors (last_heartbeat_at)
  where enabled and paused_reason is null and type = 'heartbeat';
alter table public.monitors enable row level security;

create table if not exists public.monitor_components (
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  primary key (monitor_id, component_id)
);

create index if not exists monitor_components_component_idx on public.monitor_components (component_id);
alter table public.monitor_components enable row level security;

-- Encrypted secret headers (AES-GCM with UPVANE_SECRETS_KEY). No client policies: service_role only.
create table if not exists public.monitor_secrets (
  monitor_id uuid primary key references public.monitors(id) on delete cascade,
  headers_encrypted text not null,
  header_names text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.monitor_secrets enable row level security;

create table if not exists public.monitor_region_state (
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  region text not null,
  consecutive_bad integer not null default 0,
  consecutive_up integer not null default 0,
  confirmed text not null default 'up' check (confirmed in ('up', 'degraded', 'down')),
  last_status text check (last_status in ('up', 'degraded', 'down', 'error')),
  last_latency_ms integer,
  last_error text,
  last_checked_at timestamptz,
  primary key (monitor_id, region)
);

alter table public.monitor_region_state enable row level security;

alter table public.monitor_check_results
  add column if not exists monitor_id uuid references public.monitors(id) on delete cascade,
  add column if not exists region text,
  add column if not exists details jsonb;

alter table public.monitor_check_results alter column config_id drop not null;
alter table public.monitor_check_results alter column component_id drop not null;

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'monitor_check_results' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%' and pg_get_constraintdef(con.oid) ilike '%success%'
  loop
    execute format('alter table public.monitor_check_results drop constraint %I', v_name);
  end loop;
end $$;

alter table public.monitor_check_results
  add constraint monitor_check_results_status_check check (status in ('success', 'failure', 'up', 'degraded', 'down', 'error'));

create index if not exists monitor_check_results_monitor_checked_idx on public.monitor_check_results (monitor_id, checked_at desc);

-- ------------------------------------------------------------------
-- Guards and plan limits
-- ------------------------------------------------------------------
create or replace function public.monitors_before_write()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_plan text;
  v_org uuid;
  v_limit integer;
  v_count integer;
  v_min_interval integer;
  v_max_regions integer;
begin
  select o.plan, o.id into v_plan, v_org
  from public.projects p join public.organizations o on o.id = p.organization_id
  where p.id = new.project_id;

  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Monitors cannot move between projects.' using errcode = '42501';
  end if;

  new.regions := array(select distinct r from unnest(new.regions) r order by r);
  v_min_interval := public.plan_limit(v_plan, 'min_interval_seconds');
  v_max_regions := public.plan_limit(v_plan, 'regions_per_monitor');

  if new.type <> 'heartbeat' and new.interval_seconds < v_min_interval then
    if public.is_privileged_session() then
      new.interval_seconds := v_min_interval;
    else
      raise exception 'Your % plan checks every % seconds at most.', v_plan, v_min_interval using errcode = 'P0001';
    end if;
  end if;

  if v_max_regions <> -1 and cardinality(new.regions) > v_max_regions then
    if public.is_privileged_session() then
      new.regions := new.regions[1:v_max_regions];
    else
      raise exception 'Your % plan allows % region% per monitor.', v_plan, v_max_regions, case when v_max_regions = 1 then '' else 's' end using errcode = 'P0001';
    end if;
  end if;

  if new.type in ('heartbeat', 'tls') then
    new.regions := array[new.regions[1]];
  end if;
  new.confirm_regions := least(new.confirm_regions, cardinality(new.regions));

  if new.enabled and new.paused_reason is null and (tg_op = 'INSERT' or not old.enabled or old.paused_reason is not null) then
    v_limit := public.plan_limit(v_plan, 'monitors');
    select count(*) into v_count
    from public.monitors m join public.projects p on p.id = m.project_id
    where p.organization_id = v_org and m.enabled and m.paused_reason is null and m.id <> new.id;
    if v_limit <> -1 and v_count >= v_limit then
      if public.is_privileged_session() then
        new.paused_reason := 'plan_limit';
      else
        raise exception 'Your % plan includes % active monitors. Pause one or upgrade.', v_plan, v_limit using errcode = 'P0001';
      end if;
    end if;
  end if;

  if new.type = 'heartbeat' and new.heartbeat_token is null then
    new.heartbeat_token := encode(extensions.gen_random_bytes(18), 'hex');
  end if;

  if new.type in ('http', 'keyword') then
    if coalesce(new.config->>'url', '') !~* '^https://' then
      raise exception 'HTTP monitors need an https:// URL.' using errcode = '22023';
    end if;
    if new.type = 'keyword' and coalesce(new.config->>'keyword', '') = '' then
      raise exception 'Keyword monitors need a keyword.' using errcode = '22023';
    end if;
  elsif new.type = 'tcp' then
    if coalesce(new.config->>'host', '') = '' or coalesce((new.config->>'port')::integer, 0) not between 1 and 65535 then
      raise exception 'TCP monitors need a host and a port between 1 and 65535.' using errcode = '22023';
    end if;
  elsif new.type in ('dns', 'tls') then
    if coalesce(new.config->>'hostname', '') = '' then
      raise exception 'Enter a hostname.' using errcode = '22023';
    end if;
  end if;

  if not new.enabled or new.paused_reason is not null then
    new.state := 'paused';
  elsif tg_op = 'UPDATE' and old.state = 'paused' then
    new.state := 'pending';
    new.next_check_at := now();
  end if;

  if tg_op = 'UPDATE' and (new.config is distinct from old.config or new.regions is distinct from old.regions or new.type is distinct from old.type) then
    new.next_check_at := now();
  end if;

  if tg_op = 'UPDATE' and not public.is_privileged_session() then
    if new.state is distinct from old.state and new.state not in ('paused', 'pending') then
      raise exception 'Monitor state is managed by Upvane.' using errcode = '42501';
    end if;
    if new.last_result is distinct from old.last_result or new.last_heartbeat_at is distinct from old.last_heartbeat_at
       or new.tls_expires_at is distinct from old.tls_expires_at or new.heartbeat_token is distinct from old.heartbeat_token then
      raise exception 'These monitor fields are managed by Upvane.' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists monitors_before_write on public.monitors;
create trigger monitors_before_write before insert or update on public.monitors
for each row execute procedure public.monitors_before_write();

create or replace function public.monitor_components_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.monitors m join public.components c on c.project_id = m.project_id
    where m.id = new.monitor_id and c.id = new.component_id
  ) then
    raise exception 'The monitor and the component must belong to the same status page.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists monitor_components_guard on public.monitor_components;
create trigger monitor_components_guard before insert or update on public.monitor_components
for each row execute procedure public.monitor_components_guard();

-- ------------------------------------------------------------------
-- External signals (Alertmanager, Grafana, Datadog, CloudWatch, generic)
-- ------------------------------------------------------------------
create table if not exists public.inbound_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('alertmanager', 'grafana', 'datadog', 'cloudwatch', 'generic')),
  name text not null check (char_length(name) between 1 and 80),
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  enabled boolean not null default true,
  mappings jsonb not null default '[]'::jsonb,
  default_component_id uuid references public.components(id) on delete set null,
  default_status text not null default 'partial_outage' check (default_status in ('degraded', 'partial_outage', 'major_outage')),
  auto_draft_incident boolean not null default false,
  last_received_at timestamptz,
  last_error text,
  received_count bigint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inbound_integrations_project_idx on public.inbound_integrations (project_id);
alter table public.inbound_integrations enable row level security;

create table if not exists public.component_signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  integration_id uuid not null references public.inbound_integrations(id) on delete cascade,
  external_id text not null,
  status text not null check (status in ('degraded', 'partial_outage', 'major_outage')),
  summary text,
  labels jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (integration_id, external_id, component_id)
);

create index if not exists component_signals_component_active_idx on public.component_signals (component_id) where active;
alter table public.component_signals enable row level security;

drop trigger if exists touch_inbound_integrations_updated_at on public.inbound_integrations;
create trigger touch_inbound_integrations_updated_at before update on public.inbound_integrations
for each row execute procedure public.touch_updated_at();

-- ------------------------------------------------------------------
-- Automation → component
-- ------------------------------------------------------------------
create or replace function public.recompute_component_automation(p_component_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor_status text;
  v_signal_status text;
  v_new text;
  v_source text;
begin
  select s into v_monitor_status from (
    select case m.state when 'down' then m.failure_status when 'degraded' then m.degraded_status when 'up' then 'operational' end as s
    from public.monitor_components mc
    join public.monitors m on m.id = mc.monitor_id
    where mc.component_id = p_component_id and m.enabled and m.paused_reason is null and m.state in ('up', 'degraded', 'down')
  ) x
  order by public.status_rank(s) desc
  limit 1;

  select status into v_signal_status
  from public.component_signals
  where component_id = p_component_id and active
  order by public.status_rank(status) desc
  limit 1;

  v_new := public.worst_status(v_monitor_status, v_signal_status);
  v_source := case
    when v_signal_status is not null and public.status_rank(v_signal_status) > public.status_rank(coalesce(v_monitor_status, 'operational')) then 'signal'
    when v_monitor_status is not null then 'monitor'
    when v_signal_status is not null then 'signal'
    else null
  end;

  update public.components
  set automated_status = v_new, automated_source = v_source
  where id = p_component_id
    and (automated_status is distinct from v_new or automated_source is distinct from v_source);
end;
$$;

create or replace function public.monitors_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component uuid;
  v_monitor public.monitors := coalesce(new, old);
begin
  for v_component in select component_id from public.monitor_components where monitor_id = v_monitor.id loop
    perform public.recompute_component_automation(v_component);
  end loop;
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    perform public.emit_monitor_transition(new.id, old.state, new.state);
  end if;
  return null;
end;
$$;

drop trigger if exists monitors_after_change on public.monitors;
create trigger monitors_after_change after update on public.monitors
for each row when (
  old.state is distinct from new.state
  or old.enabled is distinct from new.enabled
  or old.paused_reason is distinct from new.paused_reason
  or old.failure_status is distinct from new.failure_status
  or old.degraded_status is distinct from new.degraded_status
)
execute procedure public.monitors_after_change();

create or replace function public.monitor_components_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_component_automation(coalesce(new.component_id, old.component_id));
  return null;
end;
$$;

drop trigger if exists monitor_components_after_change on public.monitor_components;
create trigger monitor_components_after_change after insert or update or delete on public.monitor_components
for each row execute procedure public.monitor_components_after_change();

create or replace function public.component_signals_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_component_automation(coalesce(new.component_id, old.component_id));
  return null;
end;
$$;

drop trigger if exists component_signals_after_change on public.component_signals;
create trigger component_signals_after_change after insert or update or delete on public.component_signals
for each row execute procedure public.component_signals_after_change();

-- ------------------------------------------------------------------
-- Monitor events and draft incidents
-- ------------------------------------------------------------------
create or replace function public.monitor_target(p_monitor public.monitors)
returns text
language sql
immutable
as $$
  select case p_monitor.type
    when 'http' then coalesce(p_monitor.config->>'method', 'GET') || ' ' || coalesce(p_monitor.config->>'url', '')
    when 'keyword' then coalesce(p_monitor.config->>'url', '')
    when 'tcp' then coalesce(p_monitor.config->>'host', '') || ':' || coalesce(p_monitor.config->>'port', '')
    when 'dns' then coalesce(p_monitor.config->>'record_type', 'A') || ' ' || coalesce(p_monitor.config->>'hostname', '')
    when 'tls' then coalesce(p_monitor.config->>'hostname', '') || ':' || coalesce(p_monitor.config->>'port', '443')
    else 'heartbeat'
  end
$$;

create or replace function public.emit_monitor_transition(p_monitor_id uuid, p_previous text, p_current text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor public.monitors;
  v_project public.projects;
  v_type text;
  v_draft public.incidents;
  v_components jsonb;
  v_payload jsonb;
begin
  if public.events_suppressed() then return; end if;
  if p_current = 'down' and p_previous in ('pending', 'up', 'degraded') then
    v_type := 'monitor_down';
  elsif p_current = 'degraded' and p_previous in ('pending', 'up') then
    v_type := 'monitor_degraded';
  elsif p_current = 'up' and p_previous in ('down', 'degraded') then
    v_type := 'monitor_recovered';
  else
    return;
  end if;

  select * into v_monitor from public.monitors where id = p_monitor_id;
  select * into v_project from public.projects where id = v_monitor.project_id;

  if v_type = 'monitor_down' and v_monitor.auto_draft_incident and v_project.auto_draft_incidents
     and exists (select 1 from public.monitor_components where monitor_id = p_monitor_id)
     and not exists (
       select 1 from public.incidents
       where source_monitor_id = p_monitor_id and deleted_at is null and status <> 'resolved'
     ) then
    select coalesce(jsonb_object_agg(mc.component_id::text, v_monitor.failure_status), '{}'::jsonb) into v_components
    from public.monitor_components mc where mc.monitor_id = p_monitor_id;
    v_draft := public.create_incident(
      v_monitor.project_id,
      v_monitor.name || ' is failing',
      coalesce('Upvane confirmed the failure: ' || v_monitor.last_error, 'Upvane confirmed a failure on ' || v_monitor.name || '.'),
      'draft',
      case v_monitor.failure_status when 'major_outage' then 'major' else 'minor' end,
      v_components,
      false,
      'monitor',
      'Upvane',
      p_monitor_id,
      v_monitor.state_changed_at
    );
  end if;

  v_payload := jsonb_build_object(
    'project_id', v_project.id,
    'project_name', v_project.name,
    'event_type', v_type,
    'status', p_current,
    'severity', case p_current when 'down' then v_monitor.failure_status when 'degraded' then v_monitor.degraded_status else 'operational' end,
    'reason', case v_type
      when 'monitor_down' then format('%s is down: %s', v_monitor.name, coalesce(v_monitor.last_error, 'checks are failing'))
      when 'monitor_degraded' then format('%s is degraded: %s', v_monitor.name, coalesce(v_monitor.last_error, 'checks are slow or failing assertions'))
      else format('%s recovered.', v_monitor.name)
    end,
    'occurred_at', now(),
    'dashboard_path', format('/p/%s/monitors/%s', v_project.id, v_monitor.id),
    'monitor', jsonb_build_object(
      'id', v_monitor.id, 'name', v_monitor.name, 'type', v_monitor.type, 'target', public.monitor_target(v_monitor),
      'state', p_current, 'previous_state', p_previous, 'last_error', v_monitor.last_error,
      'last_result', v_monitor.last_result, 'regions', to_jsonb(v_monitor.regions)
    ),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
      from public.monitor_components mc join public.components c on c.id = mc.component_id
      where mc.monitor_id = p_monitor_id
    ), '[]'::jsonb),
    'draft_incident_id', v_draft.id,
    'draft_incident_path', case when v_draft.id is null then null else format('/p/%s/incidents/%s', v_project.id, v_draft.id) end
  );

  perform public.enqueue_alert_event_and_dispatch(
    v_project.id, v_type, 'monitor', p_monitor_id::text,
    case p_current when 'down' then v_monitor.failure_status when 'degraded' then v_monitor.degraded_status else 'operational' end,
    format('monitor:%s', p_monitor_id),
    v_payload
  );
end;
$$;

-- ------------------------------------------------------------------
-- Runner RPCs (service_role only)
-- ------------------------------------------------------------------
create or replace function public.monitor_run_payload(p_monitor public.monitors)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_monitor.id,
    'project_id', p_monitor.project_id,
    'name', p_monitor.name,
    'type', p_monitor.type,
    'config', p_monitor.config,
    'regions', to_jsonb(p_monitor.regions),
    'timeout_ms', p_monitor.timeout_ms,
    'interval_seconds', p_monitor.interval_seconds,
    'confirm_failures', p_monitor.confirm_failures,
    'confirm_regions', p_monitor.confirm_regions,
    'recovery_successes', p_monitor.recovery_successes,
    'state', p_monitor.state,
    'tls_checked_at', p_monitor.tls_checked_at,
    'secret_headers', (select s.headers_encrypted from public.monitor_secrets s where s.monitor_id = p_monitor.id),
    'region_states', coalesce((
      select jsonb_object_agg(r.region, jsonb_build_object(
        'consecutive_bad', r.consecutive_bad, 'consecutive_up', r.consecutive_up, 'confirmed', r.confirmed,
        'last_status', r.last_status
      ))
      from public.monitor_region_state r where r.monitor_id = p_monitor.id
    ), '{}'::jsonb)
  )
$$;

create or replace function public.claim_due_monitors(p_limit integer default 100)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor public.monitors;
begin
  for v_monitor in
    with due as (
      select m.id from public.monitors m
      where m.enabled and m.paused_reason is null and m.type <> 'heartbeat' and m.next_check_at <= now()
      order by m.next_check_at
      limit greatest(1, least(coalesce(p_limit, 100), 500))
      for update skip locked
    )
    update public.monitors m
    set next_check_at = now() + make_interval(secs => m.interval_seconds), last_claimed_at = now()
    from due where m.id = due.id
    returning m.*
  loop
    return next public.monitor_run_payload(v_monitor);
  end loop;
end;
$$;

create or replace function public.claim_monitor(p_monitor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor public.monitors;
begin
  update public.monitors
  set next_check_at = now() + make_interval(secs => interval_seconds), last_claimed_at = now()
  where id = p_monitor_id and type <> 'heartbeat'
    and (last_claimed_at is null or last_claimed_at < now() - interval '10 seconds')
  returning * into v_monitor;
  if not found then
    return null;
  end if;
  return public.monitor_run_payload(v_monitor);
end;
$$;

create or replace function public.record_monitor_run(
  p_monitor_id uuid,
  p_results jsonb,
  p_region_states jsonb,
  p_state text,
  p_summary jsonb,
  p_last_error text default null,
  p_tls_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor public.monitors;
  v_result jsonb;
  v_region jsonb;
  v_component_status text;
  v_warn_days integer;
begin
  select * into v_monitor from public.monitors where id = p_monitor_id for update;
  if not found then return; end if;
  -- A null state keeps the current one (every probe errored before the monitor had a confirmed state).
  if p_state is not null and p_state not in ('up', 'degraded', 'down') then
    raise exception 'Invalid monitor state %.', p_state using errcode = '22023';
  end if;

  for v_result in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_component_status := case v_result->>'status'
      when 'down' then v_monitor.failure_status
      when 'degraded' then v_monitor.degraded_status
      when 'up' then 'operational'
      else null
    end;
    insert into public.monitor_check_results (monitor_id, project_id, region, status, resulting_status, http_status, response_time_ms, error_message, details, checked_at)
    values (
      p_monitor_id, v_monitor.project_id, v_result->>'region', v_result->>'status', v_component_status,
      nullif(v_result->>'http_status', '')::integer,
      nullif(v_result->>'latency_ms', '')::integer,
      left(v_result->>'error', 1000),
      v_result->'details',
      coalesce(nullif(v_result->>'checked_at', '')::timestamptz, now())
    );
  end loop;

  for v_region in select value from jsonb_array_elements(coalesce(p_region_states, '[]'::jsonb)) loop
    insert into public.monitor_region_state (monitor_id, region, consecutive_bad, consecutive_up, confirmed, last_status, last_latency_ms, last_error, last_checked_at)
    values (
      p_monitor_id, v_region->>'region',
      coalesce((v_region->>'consecutive_bad')::integer, 0),
      coalesce((v_region->>'consecutive_up')::integer, 0),
      coalesce(v_region->>'confirmed', 'up'),
      v_region->>'last_status',
      nullif(v_region->>'last_latency_ms', '')::integer,
      left(v_region->>'last_error', 1000),
      now()
    )
    on conflict (monitor_id, region) do update set
      consecutive_bad = excluded.consecutive_bad,
      consecutive_up = excluded.consecutive_up,
      confirmed = excluded.confirmed,
      last_status = excluded.last_status,
      last_latency_ms = excluded.last_latency_ms,
      last_error = excluded.last_error,
      last_checked_at = excluded.last_checked_at;
  end loop;

  delete from public.monitor_region_state where monitor_id = p_monitor_id and region <> all(v_monitor.regions);

  update public.monitors set
    state = case when enabled and paused_reason is null and p_state is not null then p_state else state end,
    state_changed_at = case when enabled and paused_reason is null and p_state is not null and state is distinct from p_state then now() else state_changed_at end,
    last_checked_at = now(),
    last_result = p_summary,
    last_error = case when p_state = 'up' then null else coalesce(left(p_last_error, 1000), last_error) end,
    tls_expires_at = coalesce(p_tls_expires_at, tls_expires_at),
    tls_checked_at = case when p_tls_expires_at is not null then now() else tls_checked_at end
  where id = p_monitor_id;

  if p_tls_expires_at is not null then
    v_warn_days := coalesce((v_monitor.config->>'tls_warn_days')::integer, (v_monitor.config->>'warn_days')::integer, 14);
    if p_tls_expires_at < now() + make_interval(days => v_warn_days)
       and (v_monitor.tls_warned_at is null or v_monitor.tls_warned_at < now() - interval '1 day') then
      update public.monitors set tls_warned_at = now() where id = p_monitor_id;
      perform public.enqueue_alert_event_and_dispatch(
        v_monitor.project_id, 'tls_expiring', 'monitor', p_monitor_id::text, 'degraded',
        format('monitor:%s:tls:%s', p_monitor_id, to_char(now(), 'YYYY-MM-DD')),
        jsonb_build_object(
          'project_id', v_monitor.project_id,
          'project_name', (select name from public.projects where id = v_monitor.project_id),
          'event_type', 'tls_expiring',
          'status', 'degraded',
          'severity', 'degraded',
          'reason', format('The TLS certificate for %s expires on %s.', public.monitor_target(v_monitor), to_char(p_tls_expires_at, 'YYYY-MM-DD')),
          'occurred_at', now(),
          'dashboard_path', format('/p/%s/monitors/%s', v_monitor.project_id, v_monitor.id),
          'monitor', jsonb_build_object('id', v_monitor.id, 'name', v_monitor.name, 'type', v_monitor.type, 'target', public.monitor_target(v_monitor), 'tls_expires_at', p_tls_expires_at)
        )
      );
    end if;
  end if;
end;
$$;

create or replace function public.record_heartbeat(p_token text, p_success boolean default true, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor public.monitors;
  v_state text;
begin
  select * into v_monitor from public.monitors where heartbeat_token = p_token and type = 'heartbeat' for update;
  if not found then
    return null;
  end if;
  if not v_monitor.enabled or v_monitor.paused_reason is not null then
    return jsonb_build_object('id', v_monitor.id, 'state', 'paused');
  end if;
  v_state := case when p_success then 'up' else 'down' end;
  update public.monitors set
    last_heartbeat_at = now(),
    last_checked_at = now(),
    state = v_state,
    state_changed_at = case when state is distinct from v_state then now() else state_changed_at end,
    last_error = case when p_success then null else coalesce(left(p_message, 500), 'The job reported a failure.') end,
    last_result = jsonb_build_object('received_at', now(), 'success', p_success, 'message', left(p_message, 500))
  where id = v_monitor.id;
  insert into public.monitor_check_results (monitor_id, project_id, region, status, resulting_status, error_message, details, checked_at)
  values (v_monitor.id, v_monitor.project_id, 'heartbeat', v_state,
          case when p_success then 'operational' else v_monitor.failure_status end,
          case when p_success then null else left(p_message, 500) end,
          jsonb_build_object('kind', 'heartbeat'), now());
  return jsonb_build_object('id', v_monitor.id, 'state', v_state);
end;
$$;

create or replace function public.process_heartbeats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monitor public.monitors;
  v_count integer := 0;
begin
  for v_monitor in
    select * from public.monitors m
    where m.type = 'heartbeat' and m.enabled and m.paused_reason is null and m.state <> 'down'
      and coalesce(m.last_heartbeat_at, m.created_at)
          + make_interval(secs => m.interval_seconds + coalesce((m.config->>'grace_seconds')::integer, 300)) < now()
    for update skip locked
  loop
    update public.monitors set
      state = 'down',
      state_changed_at = now(),
      last_error = case when v_monitor.last_heartbeat_at is null then 'No heartbeat received yet.'
                        else 'No heartbeat since ' || to_char(v_monitor.last_heartbeat_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.' end
    where id = v_monitor.id;
    insert into public.monitor_check_results (monitor_id, project_id, region, status, resulting_status, error_message, details, checked_at)
    values (v_monitor.id, v_monitor.project_id, 'heartbeat', 'down', v_monitor.failure_status, 'Heartbeat missed.', jsonb_build_object('kind', 'heartbeat_missed'), now());
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.ingest_signals(p_integration_id uuid, p_signals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_integration public.inbound_integrations;
  v_signal jsonb;
  v_component uuid;
  v_status text;
  v_active boolean;
  v_upserted integer := 0;
  v_resolved integer := 0;
  v_components jsonb;
begin
  select * into v_integration from public.inbound_integrations where id = p_integration_id for update;
  if not found or not v_integration.enabled then
    raise exception 'Integration not found or disabled.' using errcode = 'P0002';
  end if;

  for v_signal in select value from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) loop
    v_component := nullif(v_signal->>'component_id', '')::uuid;
    if v_component is null or not exists (select 1 from public.components where id = v_component and project_id = v_integration.project_id) then
      continue;
    end if;
    v_status := coalesce(nullif(v_signal->>'status', ''), v_integration.default_status);
    if v_status not in ('degraded', 'partial_outage', 'major_outage') then v_status := v_integration.default_status; end if;
    v_active := coalesce((v_signal->>'active')::boolean, true);

    if v_active then
      insert into public.component_signals (project_id, component_id, integration_id, external_id, status, summary, labels, active, started_at, resolved_at, updated_at)
      values (v_integration.project_id, v_component, p_integration_id, left(v_signal->>'external_id', 300), v_status,
              left(v_signal->>'summary', 500), coalesce(v_signal->'labels', '{}'::jsonb), true, now(), null, now())
      on conflict (integration_id, external_id, component_id) do update set
        status = excluded.status, summary = excluded.summary, labels = excluded.labels, active = true,
        started_at = case when component_signals.active then component_signals.started_at else now() end,
        resolved_at = null, updated_at = now();
      v_upserted := v_upserted + 1;

      if v_integration.auto_draft_incident and v_status in ('partial_outage', 'major_outage') and not exists (
        select 1 from public.incidents i join public.incident_components ic on ic.incident_id = i.id
        where i.project_id = v_integration.project_id and ic.component_id = v_component and i.deleted_at is null and i.status <> 'resolved'
      ) then
        v_components := jsonb_build_object(v_component::text, v_status);
        perform public.create_incident(
          v_integration.project_id,
          coalesce(nullif(v_signal->>'summary', ''), v_integration.name || ' alert'),
          'Opened from ' || v_integration.name || '.',
          'draft',
          case v_status when 'major_outage' then 'major' else 'minor' end,
          v_components, false, 'signal', v_integration.name, null, now()
        );
      end if;
    else
      update public.component_signals set active = false, resolved_at = now(), updated_at = now()
      where integration_id = p_integration_id and external_id = left(v_signal->>'external_id', 300) and component_id = v_component and active;
      v_resolved := v_resolved + 1;
    end if;
  end loop;

  update public.inbound_integrations set last_received_at = now(), last_error = null, received_count = received_count + 1
  where id = p_integration_id;

  return jsonb_build_object('upserted', v_upserted, 'resolved', v_resolved);
end;
$$;

-- ------------------------------------------------------------------
-- Migrate component_monitor_configs → monitors
-- ------------------------------------------------------------------
create or replace function public.legacy_rule_to_assertion(p_rule jsonb, p_no_match_status text)
returns jsonb
language sql
immutable
as $$
  select case
    when coalesce(p_rule->>'targetStatus', 'degraded') = 'operational' then jsonb_build_object(
      'source', 'json', 'path', p_rule->>'path', 'operator', coalesce(p_rule->>'operator', 'exists'), 'value', p_rule->'value',
      'on_fail', case when p_no_match_status in ('partial_outage', 'major_outage') then 'down' else 'degraded' end
    )
    else jsonb_build_object(
      'source', 'json', 'path', p_rule->>'path',
      'operator', case coalesce(p_rule->>'operator', 'exists')
        when 'exists' then 'not_exists'
        when 'equals' then 'not_equals'
        when 'not_equals' then 'equals'
        when 'contains' then 'not_contains'
        when 'greater_than' then 'less_or_equal'
        when 'less_than' then 'greater_or_equal'
        else 'not_exists'
      end,
      'value', p_rule->'value',
      'on_fail', case when p_rule->>'targetStatus' in ('partial_outage', 'major_outage') then 'down' else 'degraded' end
    )
  end
$$;

do $$
begin
  perform set_config('upvane.suppress_events', 'on', true);

  insert into public.monitors (
    project_id, name, type, enabled, interval_seconds, timeout_ms, regions, confirm_failures, confirm_regions,
    recovery_successes, config, failure_status, degraded_status, legacy_config_id, next_check_at, last_checked_at,
    created_at, auto_draft_incident
  )
  select
    c.project_id,
    left(comp.name || ' health', 120),
    'http',
    c.mode = 'automatic' and c.enabled,
    greatest(c.interval_seconds, 60),
    c.timeout_ms,
    array['eu-central-1']::text[],
    2, 1, 2,
    jsonb_build_object(
      'url', c.url,
      'method', c.method,
      'expected_status_codes', to_jsonb(c.expected_status_codes),
      'follow_redirects', false,
      'headers', '[]'::jsonb,
      'assertions', case when c.response_type = 'json' then coalesce((
        select jsonb_agg(public.legacy_rule_to_assertion(r.value, c.no_match_status))
        from jsonb_array_elements(case when jsonb_typeof(c.json_rules) = 'array' then c.json_rules else '[]'::jsonb end) r(value)
      ), '[]'::jsonb) else '[]'::jsonb end
    ),
    case when c.failure_status in ('degraded', 'partial_outage', 'major_outage') then c.failure_status else 'major_outage' end,
    case when c.no_match_status in ('degraded', 'partial_outage', 'major_outage') then c.no_match_status else 'degraded' end,
    c.id,
    now(),
    c.last_checked_at,
    c.created_at,
    false
  from public.component_monitor_configs c
  join public.components comp on comp.id = c.component_id
  where c.url is not null and c.url ~* '^https://'
  on conflict (legacy_config_id) do nothing;

  insert into public.monitor_components (monitor_id, component_id)
  select m.id, c.component_id
  from public.monitors m join public.component_monitor_configs c on c.id = m.legacy_config_id
  on conflict do nothing;

  update public.monitor_check_results r
  set monitor_id = m.id, region = coalesce(r.region, 'legacy')
  from public.monitors m
  where m.legacy_config_id = r.config_id and r.monitor_id is null;

  -- The old runner reads this table; disable it so a stale deployment cannot double-check.
  update public.component_monitor_configs set enabled = false where enabled;

  perform set_config('upvane.suppress_events', 'off', true);
end $$;

-- ------------------------------------------------------------------
-- Function privileges
-- ------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.recompute_component_automation(uuid)',
    'public.emit_monitor_transition(uuid, text, text)',
    'public.monitor_run_payload(public.monitors)',
    'public.claim_due_monitors(integer)',
    'public.claim_monitor(uuid)',
    'public.record_monitor_run(uuid, jsonb, jsonb, text, jsonb, text, timestamptz)',
    'public.record_heartbeat(text, boolean, text)',
    'public.process_heartbeats()',
    'public.ingest_signals(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;
