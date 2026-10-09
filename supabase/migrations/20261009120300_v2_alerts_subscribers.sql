-- ==========================================
-- Migration: v2 alert channels, routing rules, anti-flap cooldowns and status page subscribers
-- ==========================================
-- Fixes A-1 (project settings ignored in production), A-8 (unverified recipients), C-3 (callable by anon),
-- M-3 (stuck deliveries) and adds Slack, Teams, Discord, signed webhooks, PagerDuty and Opsgenie.

-- ------------------------------------------------------------------
-- Status page settings on projects (also used to render alert emails)
-- ------------------------------------------------------------------
alter table public.projects
  add column if not exists visibility text not null default 'public',
  add column if not exists brand_color text,
  add column if not exists logo_url text,
  add column if not exists theme_default text not null default 'system',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists hide_powered_by boolean not null default false,
  add column if not exists custom_domain text,
  add column if not exists custom_domain_status text not null default 'none',
  add column if not exists custom_domain_verified_at timestamptz,
  add column if not exists custom_domain_error text,
  add column if not exists allowed_ips text[] not null default '{}'::text[],
  add column if not exists support_url text;

-- ------------------------------------------------------------------
-- Channels, recipients, rules
-- ------------------------------------------------------------------
create table if not exists public.alert_channels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('email', 'slack', 'teams', 'discord', 'webhook', 'pagerduty', 'opsgenie')),
  name text not null check (char_length(name) between 1 and 80),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  legacy_config_id uuid unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists alert_channels_project_idx on public.alert_channels (project_id);
alter table public.alert_channels enable row level security;

-- Encrypted webhook URLs, routing keys and signing secrets. No client policies: service_role only.
create table if not exists public.alert_channel_secrets (
  channel_id uuid primary key references public.alert_channels(id) on delete cascade,
  secret_encrypted text not null,
  hint text,
  updated_at timestamptz not null default now()
);

alter table public.alert_channel_secrets enable row level security;

create table if not exists public.alert_email_recipients (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.alert_channels(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  verified_at timestamptz,
  token_hash text unique,
  verification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel_id, email)
);

alter table public.alert_email_recipients enable row level security;

create or replace function public.alert_event_types()
returns text[]
language sql
immutable
as $$
  select array[
    'component_status_worsened', 'component_recovered',
    'monitor_down', 'monitor_degraded', 'monitor_recovered', 'tls_expiring',
    'incident_created', 'incident_updated', 'incident_resolved', 'incident_draft_created',
    'maintenance_scheduled', 'maintenance_reminder', 'maintenance_started', 'maintenance_completed', 'maintenance_cancelled',
    'monitor_check_failed', 'monitor_check_recovered', 'test'
  ]::text[]
$$;

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  enabled boolean not null default true,
  event_types text[] not null check (cardinality(event_types) >= 1 and event_types <@ public.alert_event_types()),
  component_ids uuid[] not null default '{}'::uuid[],
  monitor_ids uuid[] not null default '{}'::uuid[],
  min_status text check (min_status is null or min_status in ('degraded', 'partial_outage', 'major_outage')),
  channel_ids uuid[] not null default '{}'::uuid[],
  cooldown_minutes integer not null default 15 check (cooldown_minutes between 0 and 1440),
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists alert_rules_project_idx on public.alert_rules (project_id, position);
alter table public.alert_rules enable row level security;

create table if not exists public.alert_rule_cooldowns (
  rule_id uuid not null references public.alert_rules(id) on delete cascade,
  dedupe_key text not null,
  last_event_type text not null,
  last_rank integer not null default 0,
  last_sent_at timestamptz not null,
  last_event_id uuid,
  primary key (rule_id, dedupe_key)
);

alter table public.alert_rule_cooldowns enable row level security;

create table if not exists public.alert_worker_wakeups (
  name text primary key,
  last_woken_at timestamptz not null
);

alter table public.alert_worker_wakeups enable row level security;

alter table public.project_alert_configs
  add column if not exists mute_during_maintenance boolean not null default true;
alter table public.project_alert_configs alter column enabled set default true;

drop trigger if exists touch_alert_channels_updated_at on public.alert_channels;
create trigger touch_alert_channels_updated_at before update on public.alert_channels
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_alert_rules_updated_at on public.alert_rules;
create trigger touch_alert_rules_updated_at before update on public.alert_rules
for each row execute procedure public.touch_updated_at();

create or replace function public.alert_channels_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan text;
begin
  if new.type in ('pagerduty', 'opsgenie') and not public.is_privileged_session() then
    select o.plan into v_plan from public.projects p join public.organizations o on o.id = p.organization_id where p.id = new.project_id;
    if public.plan_limit(v_plan, 'paging_channels') = 0 then
      raise exception 'PagerDuty and Opsgenie require the Business plan.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id or new.type is distinct from old.type) then
    raise exception 'The project and type of a channel cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists alert_channels_guard on public.alert_channels;
create trigger alert_channels_guard before insert or update on public.alert_channels
for each row execute procedure public.alert_channels_guard();

create or replace function public.alert_rules_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from unnest(new.channel_ids) c(id) where not exists (select 1 from public.alert_channels ch where ch.id = c.id and ch.project_id = new.project_id)) then
    raise exception 'Every channel must belong to this status page.' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(new.component_ids) c(id) where not exists (select 1 from public.components x where x.id = c.id and x.project_id = new.project_id)) then
    raise exception 'Every component must belong to this status page.' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(new.monitor_ids) c(id) where not exists (select 1 from public.monitors x where x.id = c.id and x.project_id = new.project_id)) then
    raise exception 'Every monitor must belong to this status page.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists alert_rules_guard on public.alert_rules;
create trigger alert_rules_guard before insert or update on public.alert_rules
for each row execute procedure public.alert_rules_guard();

-- ------------------------------------------------------------------
-- Status page subscribers
-- ------------------------------------------------------------------
create table if not exists public.status_page_subscribers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('email', 'slack', 'webhook')),
  email text check (email is null or (email = lower(email) and position('@' in email) > 1)),
  target_encrypted text,
  target_hint text,
  component_ids uuid[] not null default '{}'::uuid[],
  confirmed_at timestamptz,
  confirm_token_hash text unique,
  unsubscribe_token_hash text not null unique,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  check ((type = 'email' and email is not null) or (type <> 'email' and target_encrypted is not null))
);

create unique index if not exists status_page_subscribers_email_key on public.status_page_subscribers (project_id, email) where email is not null;
create index if not exists status_page_subscribers_project_idx on public.status_page_subscribers (project_id) where confirmed_at is not null;
alter table public.status_page_subscribers enable row level security;

-- ------------------------------------------------------------------
-- Events and deliveries
-- ------------------------------------------------------------------
alter table public.alert_events
  add column if not exists audience text not null default 'team',
  add column if not exists suppression_reason text,
  add column if not exists component_id uuid,
  add column if not exists monitor_id uuid,
  add column if not exists incident_id uuid,
  add column if not exists maintenance_id uuid,
  add column if not exists channel_id uuid;

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname in ('alert_events', 'alert_cooldowns') and con.contype = 'c'
      and (pg_get_constraintdef(con.oid) ilike '%type%' or pg_get_constraintdef(con.oid) ilike '%source_type%' or pg_get_constraintdef(con.oid) ilike '%channel_type%')
  loop
    execute format('alter table public.%I drop constraint %I',
      (select rel.relname from pg_constraint con join pg_class rel on rel.oid = con.conrelid where con.conname = v_name limit 1), v_name);
  end loop;
end $$;

alter table public.alert_events add constraint alert_events_type_check check (type = any(public.alert_event_types()));
alter table public.alert_events add constraint alert_events_source_type_check
  check (source_type in ('manual', 'incident', 'monitor', 'maintenance', 'signal', 'system', 'api', 'test', 'subscribers', 'monitor_next_api', 'monitor_edge_runner', 'external_api'));
alter table public.alert_events drop constraint if exists alert_events_audience_check;
alter table public.alert_events add constraint alert_events_audience_check check (audience in ('team', 'subscribers'));

create index if not exists alert_events_project_type_idx on public.alert_events (project_id, type, created_at desc);

alter table public.alert_deliveries
  add column if not exists channel_id uuid references public.alert_channels(id) on delete cascade,
  add column if not exists subscriber_id uuid references public.status_page_subscribers(id) on delete cascade,
  add column if not exists target_type text,
  add column if not exists rule_id uuid references public.alert_rules(id) on delete set null;

alter table public.alert_deliveries alter column channel_config_id drop not null;
update public.alert_deliveries set target_type = 'email' where target_type is null;
alter table public.alert_deliveries alter column target_type set not null;
alter table public.alert_deliveries drop constraint if exists alert_deliveries_target_type_check;
alter table public.alert_deliveries add constraint alert_deliveries_target_type_check
  check (target_type in ('email', 'slack', 'teams', 'discord', 'webhook', 'pagerduty', 'opsgenie', 'subscriber_email', 'subscriber_slack', 'subscriber_webhook'));

create index if not exists alert_deliveries_channel_idx on public.alert_deliveries (channel_id, created_at desc);
create index if not exists alert_deliveries_processing_idx on public.alert_deliveries (updated_at) where status = 'processing';

-- ------------------------------------------------------------------
-- Migrate legacy email channels into alert_channels + recipients + rules
-- ------------------------------------------------------------------
do $$
declare
  v_legacy record;
  v_channel uuid;
  v_email text;
  v_cfg record;
begin
  for v_legacy in select * from public.alert_channel_configs where type = 'email' loop
    insert into public.alert_channels (project_id, type, name, enabled, config, legacy_config_id)
    values (v_legacy.project_id, 'email', 'Team email', v_legacy.enabled, '{}'::jsonb, v_legacy.id)
    on conflict (legacy_config_id) do update set enabled = excluded.enabled
    returning id into v_channel;

    for v_email in select distinct lower(trim(value)) from jsonb_array_elements_text(coalesce(v_legacy.config->'recipients', '[]'::jsonb)) loop
      continue when v_email = '' or position('@' in v_email) <= 1;
      insert into public.alert_email_recipients (channel_id, email, verified_at)
      values (
        v_channel, v_email,
        case when exists (
          select 1 from public.projects p
          join public.organization_members m on m.organization_id = p.organization_id
          join auth.users u on u.id = m.user_id
          where p.id = v_legacy.project_id and lower(u.email) = v_email
        ) then now() else null end
      )
      on conflict (channel_id, email) do nothing;
    end loop;
  end loop;

  for v_cfg in
    select p.id as project_id, c.cooldown_minutes, c.notify_recovery, c.alert_types
    from public.projects p left join public.project_alert_configs c on c.project_id = p.id
  loop
    if not exists (select 1 from public.alert_rules where project_id = v_cfg.project_id) then
      insert into public.alert_rules (project_id, name, enabled, event_types, channel_ids, cooldown_minutes, position)
      values (
        v_cfg.project_id, 'Outages and recoveries',
        coalesce((v_cfg.alert_types->>'component_status')::boolean, true) or coalesce((v_cfg.alert_types->>'monitor_failure')::boolean, true),
        case when coalesce(v_cfg.notify_recovery, true)
          then array['component_status_worsened', 'component_recovered', 'monitor_down', 'monitor_degraded', 'monitor_recovered', 'tls_expiring']
          else array['component_status_worsened', 'monitor_down', 'monitor_degraded', 'tls_expiring'] end,
        coalesce((select array_agg(id) from public.alert_channels where project_id = v_cfg.project_id), '{}'::uuid[]),
        least(coalesce(v_cfg.cooldown_minutes, 15), 1440),
        0
      );
      insert into public.alert_rules (project_id, name, enabled, event_types, channel_ids, cooldown_minutes, position)
      values (
        v_cfg.project_id, 'Incident and maintenance updates',
        coalesce((v_cfg.alert_types->>'incident_created')::boolean, false)
          or coalesce((v_cfg.alert_types->>'incident_updated')::boolean, false)
          or coalesce((v_cfg.alert_types->>'incident_resolved')::boolean, false),
        array['incident_created', 'incident_updated', 'incident_resolved', 'maintenance_started', 'maintenance_completed'],
        coalesce((select array_agg(id) from public.alert_channels where project_id = v_cfg.project_id), '{}'::uuid[]),
        0,
        1
      );
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- Queue helpers
-- ------------------------------------------------------------------
create or replace function public.enqueue_alert_delivery_message(p_delivery_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_delivery record;
  v_msg_id bigint;
begin
  select d.id, d.event_id, e.project_id, d.target_type into v_delivery
  from public.alert_deliveries d join public.alert_events e on e.id = d.event_id
  where d.id = p_delivery_id;
  if not found then
    raise exception 'alert delivery not found: %', p_delivery_id;
  end if;
  select pgmq.send('alert-deliveries', jsonb_build_object(
    'deliveryId', v_delivery.id::text, 'eventId', v_delivery.event_id::text,
    'projectId', v_delivery.project_id::text, 'channel', v_delivery.target_type
  )) into v_msg_id;
  update public.alert_deliveries set queued_at = now(), queue_message_id = v_msg_id, updated_at = now() where id = p_delivery_id;
  return v_msg_id;
end;
$$;

create or replace function public.wake_alert_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_url text;
  v_secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  insert into public.alert_worker_wakeups (name, last_woken_at) values ('alert-worker', now())
  on conflict (name) do update set last_woken_at = now()
  where public.alert_worker_wakeups.last_woken_at < now() - interval '5 seconds';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL' limit 1$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name in ('ALERT_WORKER_SECRET', 'ALERTS_DISPATCHER_SECRET') order by name limit 1$q$ into v_secret;
  if v_url is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 2000)'
    using rtrim(v_url, '/') || '/functions/v1/alert-worker', '{"source":"enqueue"}'::jsonb,
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json');
exception when others then
  raise notice 'wake_alert_worker skipped: %', sqlerrm;
end;
$$;

create or replace function public.create_channel_deliveries(p_event_id uuid, p_channel_id uuid, p_rule_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.alert_channels;
  v_delivery uuid;
  v_recipient text;
  v_count integer := 0;
begin
  select * into v_channel from public.alert_channels where id = p_channel_id and enabled;
  if not found then
    return 0;
  end if;
  if v_channel.type = 'email' then
    for v_recipient in select email from public.alert_email_recipients where channel_id = p_channel_id and verified_at is not null loop
      insert into public.alert_deliveries (event_id, channel_id, target, target_type, idempotency_key, rule_id)
      values (p_event_id, p_channel_id, v_recipient, 'email', p_event_id::text || ':' || p_channel_id::text || ':' || v_recipient, p_rule_id)
      on conflict (idempotency_key) do nothing
      returning id into v_delivery;
      if v_delivery is not null then
        perform public.enqueue_alert_delivery_message(v_delivery);
        v_count := v_count + 1;
      end if;
    end loop;
  else
    insert into public.alert_deliveries (event_id, channel_id, target, target_type, idempotency_key, rule_id)
    values (p_event_id, p_channel_id, v_channel.name, v_channel.type, p_event_id::text || ':' || p_channel_id::text, p_rule_id)
    on conflict (idempotency_key) do nothing
    returning id into v_delivery;
    if v_delivery is not null then
      perform public.enqueue_alert_delivery_message(v_delivery);
      v_count := 1;
    end if;
  end if;
  return v_count;
end;
$$;

create or replace function public.safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.enqueue_alert_event_and_dispatch(
  p_project_id uuid,
  p_type text,
  p_source_type text,
  p_source_id text,
  p_severity text,
  p_dedupe_key text,
  p_payload jsonb
)
returns table(event_id uuid, delivery_count integer, message_count integer)
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_event_id uuid;
  v_enabled boolean := true;
  v_mute boolean := true;
  v_component_id uuid := public.safe_uuid(p_payload #>> '{component,id}');
  v_monitor_id uuid := public.safe_uuid(p_payload #>> '{monitor,id}');
  v_incident_id uuid := public.safe_uuid(p_payload #>> '{incident,id}');
  v_maintenance_id uuid := public.safe_uuid(p_payload #>> '{maintenance,id}');
  v_test_channel uuid := public.safe_uuid(p_payload ->> 'channel_id');
  v_component_ids uuid[] := '{}'::uuid[];
  v_is_recovery boolean := p_type in ('component_recovered', 'monitor_recovered');
  v_is_flap_guarded boolean := p_type in ('component_status_worsened', 'component_recovered', 'monitor_down', 'monitor_degraded', 'monitor_recovered');
  v_rank integer := public.alert_status_rank(coalesce(p_severity, p_payload->>'status'));
  v_rule public.alert_rules;
  v_cool public.alert_rule_cooldowns;
  v_channels uuid[] := '{}'::uuid[];
  v_channel_rules uuid[] := '{}'::uuid[];
  v_channel uuid;
  v_matched integer := 0;
  v_cooled integer := 0;
  v_deliveries integer := 0;
  v_reason text;
  v_plan text;
  i integer;
begin
  if v_component_id is not null then
    v_component_ids := array[v_component_id];
  elsif v_monitor_id is not null then
    select coalesce(array_agg(component_id), '{}'::uuid[]) into v_component_ids from public.monitor_components where monitor_id = v_monitor_id;
  end if;

  insert into public.alert_events (project_id, type, source_type, source_id, severity, dedupe_key, payload, component_id, monitor_id, incident_id, maintenance_id, channel_id, audience)
  values (p_project_id, p_type, p_source_type, p_source_id, p_severity, p_dedupe_key, p_payload, v_component_id, v_monitor_id, v_incident_id, v_maintenance_id, v_test_channel, 'team')
  returning id into v_event_id;

  select c.enabled, c.mute_during_maintenance into v_enabled, v_mute from public.project_alert_configs c where c.project_id = p_project_id;
  v_enabled := coalesce(v_enabled, true);
  v_mute := coalesce(v_mute, true);
  select o.plan into v_plan from public.projects p join public.organizations o on o.id = p.organization_id where p.id = p_project_id;

  if p_type = 'test' then
    for v_channel in
      select id from public.alert_channels where project_id = p_project_id and enabled and (v_test_channel is null or id = v_test_channel)
    loop
      v_deliveries := v_deliveries + public.create_channel_deliveries(v_event_id, v_channel, null);
    end loop;
    v_reason := 'no_verified_targets';
  elsif not v_enabled then
    v_reason := 'alerts_disabled';
  elsif v_mute and p_type in ('component_status_worsened', 'component_recovered', 'monitor_down', 'monitor_degraded', 'monitor_recovered', 'tls_expiring')
        and cardinality(v_component_ids) > 0
        and not exists (
          select 1 from unnest(v_component_ids) c(id)
          where not exists (
            select 1 from public.maintenance_components mc join public.maintenances m on m.id = mc.maintenance_id
            where mc.component_id = c.id and m.status = 'in_progress' and m.mute_alerts
          )
        ) then
    v_reason := 'maintenance';
  else
    for v_rule in
      select * from public.alert_rules r
      where r.project_id = p_project_id and r.enabled and p_type = any(r.event_types)
        and (cardinality(r.component_ids) = 0 or r.component_ids && v_component_ids)
        and (cardinality(r.monitor_ids) = 0 or v_monitor_id = any(r.monitor_ids))
        and (r.min_status is null or v_is_recovery or v_rank >= public.alert_status_rank(r.min_status))
      order by r.position, r.created_at
    loop
      v_matched := v_matched + 1;
      if v_is_flap_guarded then
        select * into v_cool from public.alert_rule_cooldowns where rule_id = v_rule.id and dedupe_key = p_dedupe_key;
        if v_is_recovery then
          -- Only announce a recovery if this rule announced the problem.
          if v_cool.rule_id is null or v_cool.last_event_type in ('component_recovered', 'monitor_recovered') then
            v_cooled := v_cooled + 1;
            continue;
          end if;
        elsif v_cool.rule_id is not null
              and v_cool.last_event_type not in ('component_recovered', 'monitor_recovered')
              and v_rank <= v_cool.last_rank
              and v_cool.last_sent_at > now() - make_interval(mins => v_rule.cooldown_minutes) then
          -- Same or lower severity than what was already sent inside the cooldown: not new information.
          v_cooled := v_cooled + 1;
          continue;
        end if;
        insert into public.alert_rule_cooldowns (rule_id, dedupe_key, last_event_type, last_rank, last_sent_at, last_event_id)
        values (v_rule.id, p_dedupe_key, p_type, v_rank, now(), v_event_id)
        on conflict (rule_id, dedupe_key) do update set
          last_event_type = excluded.last_event_type, last_rank = excluded.last_rank,
          last_sent_at = excluded.last_sent_at, last_event_id = excluded.last_event_id;
      end if;
      for i in 1 .. coalesce(cardinality(v_rule.channel_ids), 0) loop
        if not (v_rule.channel_ids[i] = any(v_channels)) then
          v_channels := v_channels || v_rule.channel_ids[i];
          v_channel_rules := v_channel_rules || v_rule.id;
        end if;
      end loop;
    end loop;

    for i in 1 .. coalesce(cardinality(v_channels), 0) loop
      if public.plan_limit(v_plan, 'paging_channels') = 0
         and exists (select 1 from public.alert_channels where id = v_channels[i] and type in ('pagerduty', 'opsgenie')) then
        continue;
      end if;
      v_deliveries := v_deliveries + public.create_channel_deliveries(v_event_id, v_channels[i], v_channel_rules[i]);
    end loop;

    v_reason := case
      when v_matched = 0 then 'no_matching_rule'
      when v_cooled = v_matched then 'cooldown'
      else 'no_verified_targets'
    end;
  end if;

  if v_deliveries = 0 then
    update public.alert_events set status = 'suppressed', suppression_reason = v_reason, processed_at = now() where id = v_event_id;
  else
    perform public.wake_alert_worker();
  end if;

  return query select v_event_id, v_deliveries, v_deliveries;
end;
$$;

create or replace function public.enqueue_subscriber_notification(
  p_project_id uuid,
  p_type text,
  p_ref_id uuid,
  p_component_ids uuid[],
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_event_id uuid;
  v_subscriber public.status_page_subscribers;
  v_delivery uuid;
  v_count integer := 0;
begin
  if public.events_suppressed() then return 0; end if;
  insert into public.alert_events (project_id, type, source_type, source_id, severity, dedupe_key, payload, incident_id, maintenance_id, audience)
  values (
    p_project_id, p_type, 'subscribers', p_ref_id::text, p_payload->>'severity',
    format('subscribers:%s:%s:%s', p_ref_id, p_type, extract(epoch from clock_timestamp())::bigint),
    p_payload,
    case when p_type like 'incident_%' then p_ref_id else null end,
    case when p_type like 'maintenance_%' then p_ref_id else null end,
    'subscribers'
  )
  returning id into v_event_id;

  for v_subscriber in
    select * from public.status_page_subscribers s
    where s.project_id = p_project_id and s.confirmed_at is not null
      and (cardinality(s.component_ids) = 0 or cardinality(coalesce(p_component_ids, '{}'::uuid[])) = 0 or s.component_ids && p_component_ids)
  loop
    insert into public.alert_deliveries (event_id, subscriber_id, target, target_type, idempotency_key)
    values (
      v_event_id, v_subscriber.id,
      coalesce(v_subscriber.email, v_subscriber.target_hint, v_subscriber.type),
      'subscriber_' || v_subscriber.type,
      v_event_id::text || ':subscriber:' || v_subscriber.id::text
    )
    on conflict (idempotency_key) do nothing
    returning id into v_delivery;
    if v_delivery is not null then
      perform public.enqueue_alert_delivery_message(v_delivery);
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count = 0 then
    update public.alert_events set status = 'suppressed', suppression_reason = 'no_subscribers', processed_at = now() where id = v_event_id;
  else
    perform public.wake_alert_worker();
  end if;
  return v_count;
end;
$$;

-- ------------------------------------------------------------------
-- Worker RPCs
-- ------------------------------------------------------------------
create or replace function public.alert_worker_load_delivery(p_delivery_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'delivery', to_jsonb(d),
    'event', to_jsonb(e),
    'channel', case when ch.id is null then null else jsonb_build_object(
      'id', ch.id, 'type', ch.type, 'name', ch.name, 'enabled', ch.enabled, 'config', ch.config,
      'secret_encrypted', cs.secret_encrypted
    ) end,
    'subscriber', case when s.id is null then null else jsonb_build_object(
      'id', s.id, 'type', s.type, 'email', s.email, 'target_encrypted', s.target_encrypted, 'confirmed', s.confirmed_at is not null
    ) end,
    'project', jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'organization_slug', o.slug,
      'brand_color', p.brand_color, 'logo_url', p.logo_url, 'custom_domain', case when p.custom_domain_status = 'verified' then p.custom_domain else null end
    )
  )
  from public.alert_deliveries d
  join public.alert_events e on e.id = d.event_id
  join public.projects p on p.id = e.project_id
  join public.organizations o on o.id = p.organization_id
  left join public.alert_channels ch on ch.id = d.channel_id
  left join public.alert_channel_secrets cs on cs.channel_id = ch.id
  left join public.status_page_subscribers s on s.id = d.subscriber_id
  where d.id = p_delivery_id
$$;

create or replace function public.alert_worker_claim_delivery(p_delivery_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  update public.alert_deliveries
  set status = 'processing', attempts = attempts + 1, updated_at = now(), dispatched_at = now()
  where id = p_delivery_id
    and status in ('pending', 'retryable')
    and (next_retry_at is null or next_retry_at <= now())
  returning attempts into v_attempts;
  return v_attempts;
end;
$$;

create or replace function public.finalize_alert_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open integer;
  v_total integer;
  v_suppressed integer;
begin
  select count(*) filter (where status in ('pending', 'retryable', 'processing')),
         count(*),
         count(*) filter (where status = 'suppressed')
  into v_open, v_total, v_suppressed
  from public.alert_deliveries where event_id = p_event_id;
  if v_total = 0 or v_open > 0 then
    return;
  end if;
  update public.alert_events
  set status = case when v_suppressed = v_total then 'suppressed' else 'processed' end, processed_at = now()
  where id = p_event_id and status = 'pending';
end;
$$;

create or replace function public.alert_worker_complete_delivery(
  p_delivery_id uuid,
  p_status text,
  p_provider text,
  p_provider_message_id text,
  p_error_code text,
  p_error_message text,
  p_next_retry_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
begin
  if p_status not in ('sent', 'retryable', 'failed', 'suppressed') then
    raise exception 'Invalid delivery status %.', p_status using errcode = '22023';
  end if;
  update public.alert_deliveries set
    status = p_status,
    provider = p_provider,
    provider_message_id = p_provider_message_id,
    error_code = left(p_error_code, 120),
    error_message = left(p_error_message, 1000),
    next_retry_at = case when p_status = 'retryable' then p_next_retry_at else null end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    updated_at = now()
  where id = p_delivery_id
  returning event_id into v_event;
  if p_status = 'sent' then
    update public.status_page_subscribers s set last_notified_at = now()
    from public.alert_deliveries d where d.id = p_delivery_id and d.subscriber_id = s.id;
  end if;
  if v_event is not null then
    perform public.finalize_alert_event(v_event);
  end if;
end;
$$;

create or replace function public.recover_alert_delivery_queue(p_limit integer default 50)
returns table(delivery_id uuid, message_id bigint)
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_delivery record;
begin
  -- Deliveries stuck in processing (the worker died mid-send) go back to the retry cycle (M-3).
  update public.alert_deliveries
  set status = case when attempts >= 5 then 'failed' else 'retryable' end,
      next_retry_at = case when attempts >= 5 then null else now() end,
      error_code = coalesce(error_code, 'worker_timeout'),
      error_message = coalesce(error_message, 'The worker stopped before confirming the delivery.'),
      updated_at = now()
  where status = 'processing' and updated_at < now() - interval '5 minutes';

  for v_delivery in
    select d.id from public.alert_deliveries d
    where d.status in ('pending', 'retryable')
      and (d.next_retry_at is null or d.next_retry_at <= now())
      and (d.queued_at is null or d.queued_at < now() - interval '3 minutes')
    order by d.created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    delivery_id := v_delivery.id;
    message_id := public.enqueue_alert_delivery_message(v_delivery.id);
    return next;
  end loop;
end;
$$;

-- ------------------------------------------------------------------
-- Public RPCs: recipient verification and subscriptions
-- ------------------------------------------------------------------
create or replace function public.verify_alert_recipient(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_recipient public.alert_email_recipients;
  v_project text;
begin
  update public.alert_email_recipients
  set verified_at = coalesce(verified_at, now()), token_hash = null
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  returning * into v_recipient;
  if not found then
    return null;
  end if;
  select p.name into v_project from public.alert_channels ch join public.projects p on p.id = ch.project_id where ch.id = v_recipient.channel_id;
  return jsonb_build_object('email', v_recipient.email, 'project_name', v_project);
end;
$$;

create or replace function public.subscribe_to_status_page(
  p_project_id uuid,
  p_type text,
  p_email text,
  p_target_encrypted text,
  p_target_hint text,
  p_component_ids uuid[],
  p_confirm_token_hash text,
  p_unsubscribe_token_hash text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
  v_existing public.status_page_subscribers;
  v_components uuid[] := coalesce(p_component_ids, '{}'::uuid[]);
begin
  if p_type not in ('email', 'slack', 'webhook') then
    raise exception 'Invalid subscription type.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_components) c(id) where not exists (select 1 from public.components x where x.id = c.id and x.project_id = p_project_id)) then
    raise exception 'Unknown component.' using errcode = '22023';
  end if;

  if p_type = 'email' then
    select * into v_existing from public.status_page_subscribers where project_id = p_project_id and email = lower(p_email);
    if found then
      if v_existing.confirmed_at is not null then
        update public.status_page_subscribers set component_ids = v_components where id = v_existing.id;
        return 'already_confirmed';
      end if;
      update public.status_page_subscribers
      set confirm_token_hash = p_confirm_token_hash, unsubscribe_token_hash = p_unsubscribe_token_hash, component_ids = v_components
      where id = v_existing.id;
      return 'confirmation_sent';
    end if;
  end if;

  select o.plan into v_plan from public.projects p join public.organizations o on o.id = p.organization_id where p.id = p_project_id;
  v_limit := public.plan_limit(v_plan, 'subscribers_per_project');
  select count(*) into v_count from public.status_page_subscribers where project_id = p_project_id;
  if v_limit <> -1 and v_count >= v_limit then
    raise exception 'This status page cannot accept more subscribers right now.' using errcode = 'P0001';
  end if;

  insert into public.status_page_subscribers (project_id, type, email, target_encrypted, target_hint, component_ids, confirm_token_hash, unsubscribe_token_hash, confirmed_at)
  values (
    p_project_id, p_type, case when p_type = 'email' then lower(p_email) else null end,
    p_target_encrypted, p_target_hint, v_components,
    case when p_type = 'email' then p_confirm_token_hash else null end,
    p_unsubscribe_token_hash,
    case when p_type = 'email' then null else now() end
  );
  return case when p_type = 'email' then 'confirmation_sent' else 'subscribed' end;
end;
$$;

create or replace function public.confirm_status_page_subscription(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber public.status_page_subscribers;
begin
  update public.status_page_subscribers set confirmed_at = coalesce(confirmed_at, now()), confirm_token_hash = null
  where confirm_token_hash = p_token_hash
  returning * into v_subscriber;
  if not found then
    return null;
  end if;
  return jsonb_build_object('project_id', v_subscriber.project_id, 'email', v_subscriber.email);
end;
$$;

create or replace function public.unsubscribe_from_status_page(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber public.status_page_subscribers;
begin
  delete from public.status_page_subscribers where unsubscribe_token_hash = p_token_hash returning * into v_subscriber;
  if not found then
    return null;
  end if;
  return jsonb_build_object('project_id', v_subscriber.project_id, 'email', v_subscriber.email);
end;
$$;

-- ------------------------------------------------------------------
-- New projects get alerting that works out of the box (owner email, verified)
-- ------------------------------------------------------------------
create or replace function public.projects_after_insert_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel uuid;
  v_email text;
begin
  insert into public.project_alert_configs (project_id, enabled, cooldown_minutes, notify_recovery, mute_during_maintenance)
  values (new.id, true, 15, true, true)
  on conflict (project_id) do nothing;

  select lower(email) into v_email from auth.users where id = coalesce(new.user_id, auth.uid());
  if v_email is not null then
    insert into public.alert_channels (project_id, type, name, enabled, created_by)
    values (new.id, 'email', 'Team email', true, new.user_id)
    returning id into v_channel;
    insert into public.alert_email_recipients (channel_id, email, verified_at) values (v_channel, v_email, now());
  end if;

  insert into public.alert_rules (project_id, name, enabled, event_types, channel_ids, cooldown_minutes, position)
  values
    (new.id, 'Outages and recoveries', true,
     array['component_status_worsened', 'component_recovered', 'monitor_down', 'monitor_degraded', 'monitor_recovered', 'tls_expiring'],
     case when v_channel is null then '{}'::uuid[] else array[v_channel] end, 15, 0),
    (new.id, 'Incident and maintenance updates', false,
     array['incident_created', 'incident_updated', 'incident_resolved', 'maintenance_started', 'maintenance_completed'],
     case when v_channel is null then '{}'::uuid[] else array[v_channel] end, 0, 1);

  insert into public.slos (project_id, name, target, window_days) values (new.id, 'Status page availability', 99.9, 30)
  on conflict do nothing;
  return null;
end;
$$;

-- ------------------------------------------------------------------
-- Function privileges (C-3: execute is granted to PUBLIC by default, so revoke from PUBLIC too)
-- ------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.enqueue_alert_delivery_message(uuid)',
    'public.wake_alert_worker()',
    'public.create_channel_deliveries(uuid, uuid, uuid)',
    'public.enqueue_alert_event_and_dispatch(uuid, text, text, text, text, text, jsonb)',
    'public.enqueue_subscriber_notification(uuid, text, uuid, uuid[], jsonb)',
    'public.alert_worker_load_delivery(uuid)',
    'public.alert_worker_claim_delivery(uuid)',
    'public.alert_worker_complete_delivery(uuid, text, text, text, text, text, timestamptz)',
    'public.finalize_alert_event(uuid)',
    'public.recover_alert_delivery_queue(integer)',
    'public.alert_worker_read_messages(integer, integer)',
    'public.alert_worker_delete_message(bigint)',
    'public.alert_worker_defer_message(bigint, integer)',
    'public.alert_delivery_queue_message(uuid, uuid, uuid, text)',
    'public.schedule_alert_worker_fallback()',
    'public.subscribe_to_status_page(uuid, text, text, text, text, uuid[], text, text)',
    'public.confirm_status_page_subscription(text)',
    'public.unsubscribe_from_status_page(text)',
    'public.verify_alert_recipient(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;
