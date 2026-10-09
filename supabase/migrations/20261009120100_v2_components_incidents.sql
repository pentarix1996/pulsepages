-- ==========================================
-- Migration: v2 components, incidents, maintenance, templates, postmortems
-- ==========================================
-- One function decides a component's public status (recompute_component_status). Incidents set the status of
-- each affected component explicitly; monitors, external signals, dependencies, maintenance windows and manual
-- pins are inputs to the same function, so every entry point (panel, API, monitors) behaves the same (M-5).

-- ------------------------------------------------------------------
-- Status helpers
-- ------------------------------------------------------------------
create or replace function public.is_component_status(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')
$$;

create or replace function public.status_rank(p_status text)
returns integer
language sql
immutable
as $$
  select case p_status
    when 'major_outage' then 5
    when 'partial_outage' then 4
    when 'degraded' then 3
    when 'maintenance' then 2
    when 'operational' then 1
    else 0
  end
$$;

create or replace function public.alert_status_rank(p_status text)
returns integer
language sql
immutable
as $$
  select case p_status when 'major_outage' then 3 when 'partial_outage' then 2 when 'degraded' then 1 else 0 end
$$;

create or replace function public.worst_status(p_a text, p_b text)
returns text
language sql
immutable
as $$
  select case
    when p_a is null then p_b
    when p_b is null then p_a
    when public.status_rank(p_a) >= public.status_rank(p_b) then p_a
    else p_b
  end
$$;

create or replace function public.impact_to_severity(p_impact text)
returns text
language sql
immutable
as $$
  select case p_impact when 'critical' then 'critical' when 'major' then 'high' when 'minor' then 'medium' else 'low' end
$$;

create or replace function public.severity_to_impact(p_severity text)
returns text
language sql
immutable
as $$
  select case p_severity when 'critical' then 'critical' when 'high' then 'major' when 'medium' then 'minor' when 'low' then 'none' else null end
$$;

create or replace function public.events_suppressed()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('upvane.suppress_events', true), '') = 'on'
$$;

-- ------------------------------------------------------------------
-- Project settings used by incident automation and uptime
-- ------------------------------------------------------------------
alter table public.projects
  add column if not exists auto_postmortem boolean not null default true,
  add column if not exists auto_draft_incidents boolean not null default true,
  add column if not exists uptime_weights jsonb not null default '{"major_outage": 1, "partial_outage": 0.3, "degraded": 0}'::jsonb;

-- ------------------------------------------------------------------
-- Component groups and component columns
-- ------------------------------------------------------------------
create table if not exists public.component_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  collapsed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists component_groups_project_idx on public.component_groups (project_id, position);
alter table public.component_groups enable row level security;

alter table public.components
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists group_id uuid,
  add column if not exists position integer not null default 0,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists manual_status text,
  add column if not exists manual_status_set_by uuid references auth.users(id) on delete set null,
  add column if not exists manual_status_set_at timestamptz,
  add column if not exists automated_status text,
  add column if not exists automated_source text,
  add column if not exists status_source text not null default 'default',
  add column if not exists status_changed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'components_group_id_fkey') then
    alter table public.components add constraint components_group_id_fkey
      foreign key (group_id) references public.component_groups(id) on delete set null;
  end if;
end $$;

update public.components set status = 'operational' where status is null or not public.is_component_status(status);

update public.components c
set created_at = least(
  (select p.created_at from public.projects p where p.id = c.project_id),
  coalesce((select min(h.changed_at) from public.component_status_history h where h.component_id = c.id), now())
)
where c.created_at is null;

alter table public.components alter column created_at set default now();
alter table public.components alter column created_at set not null;

do $$
declare
  v_component record;
  v_base text;
  v_candidate text;
  v_n integer;
begin
  for v_component in select id, project_id, name from public.components where slug is null order by project_id, created_at, id loop
    v_base := coalesce(nullif(left(public.slugify(v_component.name), 60), ''), 'component');
    v_candidate := v_base;
    v_n := 1;
    while exists (select 1 from public.components where project_id = v_component.project_id and slug = v_candidate) loop
      v_n := v_n + 1;
      v_candidate := v_base || '-' || v_n;
    end loop;
    update public.components set slug = v_candidate where id = v_component.id;
  end loop;
end $$;

alter table public.components alter column slug set not null;
create unique index if not exists components_project_slug_key on public.components (project_id, slug);
create index if not exists components_project_position_idx on public.components (project_id, group_id, position);

alter table public.components drop constraint if exists components_status_check;
alter table public.components add constraint components_status_check check (public.is_component_status(status));
alter table public.components drop constraint if exists components_manual_status_check;
alter table public.components add constraint components_manual_status_check check (manual_status is null or public.is_component_status(manual_status));
alter table public.components drop constraint if exists components_automated_status_check;
alter table public.components add constraint components_automated_status_check check (automated_status is null or public.is_component_status(automated_status));
alter table public.components drop constraint if exists components_name_check;
alter table public.components add constraint components_name_check check (char_length(name) between 1 and 80) not valid;

create table if not exists public.component_dependencies (
  component_id uuid not null references public.components(id) on delete cascade,
  depends_on_id uuid not null references public.components(id) on delete cascade,
  impact text not null default 'partial_outage' check (impact in ('degraded', 'partial_outage', 'major_outage')),
  created_at timestamptz not null default now(),
  primary key (component_id, depends_on_id),
  check (component_id <> depends_on_id)
);

create index if not exists component_dependencies_depends_on_idx on public.component_dependencies (depends_on_id);
alter table public.component_dependencies enable row level security;

-- ------------------------------------------------------------------
-- Status history reasons
-- ------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'component_status_history' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%reason%'
  loop
    execute format('alter table public.component_status_history drop constraint %I', v_name);
  end loop;
end $$;

alter table public.component_status_history
  add constraint component_status_history_reason_check
  check (reason in ('incident', 'incident_resolved', 'manual', 'maintenance', 'monitor', 'monitor_recovery', 'dependency', 'signal', 'system', 'api'));

-- ------------------------------------------------------------------
-- Incidents
-- ------------------------------------------------------------------
alter table public.incidents
  add column if not exists impact text,
  add column if not exists detected_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references auth.users(id) on delete set null,
  add column if not exists published_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists source text not null default 'manual',
  add column if not exists source_monitor_id uuid,
  add column if not exists source_signal_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.incidents alter column severity drop not null;

update public.incidents set status = 'resolved' where status = 'maintenance';
update public.incidents set status = 'investigating' where status not in ('investigating', 'identified', 'monitoring', 'resolved');
update public.incidents set impact = coalesce(public.severity_to_impact(severity), 'minor') where impact is null;
update public.incidents set detected_at = created_at where detected_at is null;
update public.incidents set published_at = created_at where published_at is null;
update public.incidents i
set resolved_at = coalesce(
  (select max(u.created_at) from public.incident_updates u where u.incident_id = i.id and u.status = 'resolved'),
  i.created_at + make_interval(mins => greatest(coalesce(i.duration, 0), 0))
)
where i.status = 'resolved' and i.resolved_at is null;

alter table public.incidents alter column impact set default 'minor';
alter table public.incidents alter column impact set not null;
alter table public.incidents alter column detected_at set default now();
alter table public.incidents alter column detected_at set not null;

alter table public.incidents drop constraint if exists incidents_status_check;
alter table public.incidents add constraint incidents_status_check check (status in ('draft', 'investigating', 'identified', 'monitoring', 'resolved'));
alter table public.incidents drop constraint if exists incidents_impact_check;
alter table public.incidents add constraint incidents_impact_check check (impact in ('none', 'minor', 'major', 'critical'));
alter table public.incidents drop constraint if exists incidents_source_check;
alter table public.incidents add constraint incidents_source_check check (source in ('manual', 'monitor', 'signal', 'api', 'template'));
alter table public.incidents drop constraint if exists incidents_title_check;
alter table public.incidents add constraint incidents_title_check check (char_length(title) between 1 and 200) not valid;

create index if not exists incidents_project_created_idx on public.incidents (project_id, created_at desc);
create index if not exists incidents_project_active_idx on public.incidents (project_id) where status in ('investigating', 'identified', 'monitoring') and deleted_at is null;

create table if not exists public.incident_components (
  incident_id uuid not null references public.incidents(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  status text not null check (public.is_component_status(status)),
  updated_at timestamptz not null default now(),
  primary key (incident_id, component_id)
);

create index if not exists incident_components_component_idx on public.incident_components (component_id);
alter table public.incident_components enable row level security;

insert into public.incident_components (incident_id, component_id, status)
select i.id, c.id,
  case
    when i.status = 'resolved' then 'operational'
    when i.severity = 'critical' then 'major_outage'
    when i.severity = 'high' then 'partial_outage'
    when i.severity = 'medium' then 'degraded'
    else c.status
  end
from public.incidents i
cross join lateral unnest(coalesce(i.component_ids, '{}'::uuid[])) as cid(id)
join public.components c on c.id = cid.id and c.project_id = i.project_id
on conflict do nothing;

alter table public.incident_updates
  add column if not exists kind text not null default 'update',
  add column if not exists visibility text not null default 'public',
  add column if not exists component_statuses jsonb not null default '{}'::jsonb,
  add column if not exists notify_subscribers boolean not null default false,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists actor_label text;

alter table public.incident_updates alter column status drop not null;
alter table public.incident_updates drop constraint if exists incident_updates_kind_check;
alter table public.incident_updates add constraint incident_updates_kind_check check (kind in ('update', 'note', 'system'));
alter table public.incident_updates drop constraint if exists incident_updates_visibility_check;
alter table public.incident_updates add constraint incident_updates_visibility_check check (visibility in ('public', 'internal'));
create index if not exists incident_updates_incident_created_idx on public.incident_updates (incident_id, created_at);

create table if not exists public.incident_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  title text not null check (char_length(title) between 1 and 200),
  message text not null default '',
  impact text not null default 'minor' check (impact in ('none', 'minor', 'major', 'critical')),
  status text not null default 'investigating' check (status in ('investigating', 'identified', 'monitoring')),
  component_statuses jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incident_templates_project_idx on public.incident_templates (project_id);
alter table public.incident_templates enable row level security;

create table if not exists public.postmortems (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.incidents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null,
  summary text not null default '',
  impact text not null default '',
  root_cause text not null default '',
  resolution text not null default '',
  lessons text not null default '',
  action_items jsonb not null default '[]'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists postmortems_project_idx on public.postmortems (project_id, created_at desc);
alter table public.postmortems enable row level security;

-- ------------------------------------------------------------------
-- Maintenance windows
-- ------------------------------------------------------------------
create table if not exists public.maintenances (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  auto_start boolean not null default true,
  auto_complete boolean not null default true,
  notify_subscribers boolean not null default true,
  reminder_minutes integer not null default 1440 check (reminder_minutes between 0 and 10080),
  reminder_sent_at timestamptz,
  mute_alerts boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);

create index if not exists maintenances_project_start_idx on public.maintenances (project_id, scheduled_start desc);
create index if not exists maintenances_due_idx on public.maintenances (status, scheduled_start) where status in ('scheduled', 'in_progress');
alter table public.maintenances enable row level security;

create table if not exists public.maintenance_components (
  maintenance_id uuid not null references public.maintenances(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  primary key (maintenance_id, component_id)
);

create index if not exists maintenance_components_component_idx on public.maintenance_components (component_id);
alter table public.maintenance_components enable row level security;

create table if not exists public.maintenance_updates (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.maintenances(id) on delete cascade,
  status text check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  message text not null,
  created_by uuid references auth.users(id) on delete set null,
  actor_label text,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_updates_maintenance_idx on public.maintenance_updates (maintenance_id, created_at);
alter table public.maintenance_updates enable row level security;

-- ------------------------------------------------------------------
-- Status computation
-- ------------------------------------------------------------------
create or replace function public.recompute_component_status(
  p_component_id uuid,
  p_reason text default null,
  p_incident_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component public.components;
  v_incident_status text;
  v_incident_id uuid;
  v_maintenance_id uuid;
  v_dependency_status text;
  v_new text;
  v_source text;
  v_reason text;
begin
  select * into v_component from public.components where id = p_component_id for update;
  if not found then
    return null;
  end if;

  select ic.status, ic.incident_id into v_incident_status, v_incident_id
  from public.incident_components ic
  join public.incidents i on i.id = ic.incident_id
  where ic.component_id = p_component_id
    and i.status in ('investigating', 'identified', 'monitoring')
    and i.deleted_at is null
  order by public.status_rank(ic.status) desc, i.created_at desc
  limit 1;

  if v_incident_status is not null then
    v_new := v_incident_status;
    v_source := 'incident';
  else
    select m.id into v_maintenance_id
    from public.maintenance_components mc
    join public.maintenances m on m.id = mc.maintenance_id
    where mc.component_id = p_component_id and m.status = 'in_progress'
    limit 1;

    if v_maintenance_id is not null then
      v_new := 'maintenance';
      v_source := 'maintenance';
    elsif v_component.manual_status is not null then
      v_new := v_component.manual_status;
      v_source := 'manual';
    else
      select derived into v_dependency_status
      from (
        select case
          when dep.status = 'major_outage' then d.impact
          when dep.status in ('partial_outage', 'degraded') then 'degraded'
          else null
        end as derived
        from public.component_dependencies d
        join public.components dep on dep.id = d.depends_on_id
        where d.component_id = p_component_id
      ) x
      where derived is not null
      order by public.status_rank(derived) desc
      limit 1;

      v_new := coalesce(public.worst_status(v_component.automated_status, v_dependency_status), 'operational');
      if v_dependency_status is not null and public.status_rank(v_dependency_status) > public.status_rank(coalesce(v_component.automated_status, 'operational')) then
        v_source := 'dependency';
      elsif v_component.automated_status is not null then
        v_source := coalesce(v_component.automated_source, 'monitor');
      else
        v_source := 'default';
      end if;
    end if;
  end if;

  if v_new is distinct from v_component.status or v_source is distinct from v_component.status_source then
    update public.components
    set status = v_new,
        status_source = v_source,
        status_changed_at = case when v_new is distinct from v_component.status then now() else status_changed_at end
    where id = p_component_id;
  end if;

  if v_new is distinct from v_component.status then
    v_reason := coalesce(p_reason, case v_source
      when 'incident' then 'incident'
      when 'maintenance' then 'maintenance'
      when 'manual' then 'manual'
      when 'dependency' then 'dependency'
      when 'signal' then 'signal'
      when 'monitor' then case when v_new = 'operational' then 'monitor_recovery' else 'monitor' end
      else 'system'
    end);
    if v_reason = 'incident' and v_incident_status is null then
      v_reason := 'incident_resolved';
    end if;
    insert into public.component_status_history (component_id, status, reason, incident_id)
    values (p_component_id, v_new, v_reason, coalesce(p_incident_id, v_incident_id));
    perform public.emit_component_transition(p_component_id, v_component.status, v_new, v_reason);
  end if;

  return v_new;
end;
$$;

-- Component events are only emitted for automated or manual changes; incidents and maintenance have their own events.
create or replace function public.emit_component_transition(
  p_component_id uuid,
  p_previous text,
  p_current text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_component record;
  v_payload jsonb;
begin
  if public.events_suppressed() then return; end if;
  if p_reason in ('incident', 'incident_resolved', 'maintenance') then return; end if;

  if p_current = 'operational' and public.alert_status_rank(p_previous) > 0 then
    v_type := 'component_recovered';
  elsif public.alert_status_rank(p_current) > public.alert_status_rank(p_previous) then
    v_type := 'component_status_worsened';
  else
    return;
  end if;

  select c.id, c.name, c.slug, c.project_id, c.status_source, p.name as project_name
  into v_component
  from public.components c join public.projects p on p.id = c.project_id
  where c.id = p_component_id;

  v_payload := jsonb_build_object(
    'project_id', v_component.project_id,
    'project_name', v_component.project_name,
    'event_type', v_type,
    'status', p_current,
    'severity', p_current,
    'reason', format('%s changed from %s to %s.', v_component.name, replace(p_previous, '_', ' '), replace(p_current, '_', ' ')),
    'occurred_at', now(),
    'dashboard_path', format('/p/%s/overview', v_component.project_id),
    'component', jsonb_build_object(
      'id', v_component.id, 'name', v_component.name, 'slug', v_component.slug,
      'previous_status', p_previous, 'current_status', p_current, 'source', v_component.status_source
    ),
    'change_reason', p_reason
  );

  perform public.enqueue_alert_event_and_dispatch(
    v_component.project_id, v_type,
    case when p_reason in ('monitor', 'monitor_recovery') then 'monitor' when p_reason = 'signal' then 'signal' when p_reason = 'manual' then 'manual' else 'system' end,
    p_component_id::text, p_current,
    format('component:%s', p_component_id),
    v_payload
  );
end;
$$;

-- ------------------------------------------------------------------
-- Component triggers
-- ------------------------------------------------------------------
create or replace function public.components_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 1;
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if tg_op = 'INSERT' then
    if not public.is_privileged_session() then
      select o.plan into v_plan from public.projects p join public.organizations o on o.id = p.organization_id where p.id = new.project_id;
      v_limit := public.plan_limit(v_plan, 'components_per_project');
      select count(*) into v_count from public.components where project_id = new.project_id;
      if v_limit <> -1 and v_count >= v_limit then
        raise exception 'Your % plan allows % components per status page. Upgrade to add more.', v_plan, v_limit using errcode = 'P0001';
      end if;
    end if;
    -- A status sent on create becomes a manual pin; the effective status is computed after insert.
    if new.status is not null and public.is_component_status(new.status) and new.status <> 'operational' and new.manual_status is null then
      new.manual_status := new.status;
      new.manual_status_set_by := auth.uid();
      new.manual_status_set_at := now();
    end if;
    new.status := 'operational';
    new.status_source := 'default';
    new.created_at := coalesce(new.created_at, now());
  else
    if new.project_id is distinct from old.project_id then
      raise exception 'Components cannot move between projects.' using errcode = '42501';
    end if;
    if not public.is_privileged_session() then
      if new.status is distinct from old.status then
        -- Direct status writes from clients are treated as a manual pin.
        new.manual_status := new.status;
        new.status := old.status;
      end if;
      if new.automated_status is distinct from old.automated_status or new.automated_source is distinct from old.automated_source
         or new.status_source is distinct from old.status_source or new.status_changed_at is distinct from old.status_changed_at then
        raise exception 'Automated status fields are managed by Upvane.' using errcode = '42501';
      end if;
    end if;
    if new.manual_status is distinct from old.manual_status then
      new.manual_status_set_by := auth.uid();
      new.manual_status_set_at := case when new.manual_status is null then null else now() end;
    end if;
  end if;

  if new.group_id is not null and not exists (select 1 from public.component_groups g where g.id = new.group_id and g.project_id = new.project_id) then
    raise exception 'The group belongs to another project.' using errcode = '23503';
  end if;

  if new.slug is null or new.slug = '' then
    v_base := coalesce(nullif(left(public.slugify(new.name), 60), ''), 'component');
    v_candidate := v_base;
    while exists (select 1 from public.components where project_id = new.project_id and slug = v_candidate and id <> new.id) loop
      v_n := v_n + 1;
      v_candidate := v_base || '-' || v_n;
    end loop;
    new.slug := v_candidate;
  else
    new.slug := lower(new.slug);
    if new.slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' then
      raise exception 'Use lowercase letters, numbers or hyphens for the component key.' using errcode = '22023';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists components_before_write on public.components;
create trigger components_before_write before insert or update on public.components
for each row execute procedure public.components_before_write();

create or replace function public.components_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_component_status(new.id, null, null);
  return null;
end;
$$;

drop trigger if exists components_after_insert on public.components;
create trigger components_after_insert after insert on public.components
for each row execute procedure public.components_after_insert();

create or replace function public.components_after_input_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_component_status(new.id, case when new.manual_status is distinct from old.manual_status then 'manual' else null end, null);
  return null;
end;
$$;

drop trigger if exists components_after_input_change on public.components;
create trigger components_after_input_change after update on public.components
for each row when (
  old.manual_status is distinct from new.manual_status
  or old.automated_status is distinct from new.automated_status
  or old.automated_source is distinct from new.automated_source
)
execute procedure public.components_after_input_change();

create or replace function public.components_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dependent uuid;
begin
  if pg_trigger_depth() > 8 then
    return null;
  end if;
  for v_dependent in select component_id from public.component_dependencies where depends_on_id = new.id loop
    perform public.recompute_component_status(v_dependent, null, null);
  end loop;
  return null;
end;
$$;

drop trigger if exists components_after_status_change on public.components;
create trigger components_after_status_change after update on public.components
for each row when (old.status is distinct from new.status)
execute procedure public.components_after_status_change();

create or replace function public.component_dependencies_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_dep_project uuid;
begin
  select project_id into v_project from public.components where id = new.component_id;
  select project_id into v_dep_project from public.components where id = new.depends_on_id;
  if v_project is distinct from v_dep_project then
    raise exception 'Dependencies must be in the same status page.' using errcode = '23503';
  end if;
  if exists (
    with recursive chain(id) as (
      select new.depends_on_id
      union
      select d.depends_on_id from public.component_dependencies d join chain on d.component_id = chain.id
    )
    select 1 from chain where id = new.component_id
  ) then
    raise exception 'This dependency would create a cycle.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists component_dependencies_guard on public.component_dependencies;
create trigger component_dependencies_guard before insert or update on public.component_dependencies
for each row execute procedure public.component_dependencies_guard();

create or replace function public.component_dependencies_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_component_status(coalesce(new.component_id, old.component_id), 'dependency', null);
  return null;
end;
$$;

drop trigger if exists component_dependencies_after_change on public.component_dependencies;
create trigger component_dependencies_after_change after insert or update or delete on public.component_dependencies
for each row execute procedure public.component_dependencies_after_change();

drop trigger if exists touch_component_groups_updated_at on public.component_groups;
create trigger touch_component_groups_updated_at before update on public.component_groups
for each row execute procedure public.touch_updated_at();

-- ------------------------------------------------------------------
-- Incident triggers
-- ------------------------------------------------------------------
create or replace function public.incidents_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.impact is null then
      new.impact := coalesce(public.severity_to_impact(new.severity), 'minor');
    end if;
    new.detected_at := coalesce(new.detected_at, now());
    if new.status <> 'draft' then new.published_at := coalesce(new.published_at, now()); end if;
    if new.status = 'resolved' then new.resolved_at := coalesce(new.resolved_at, now()); end if;
  else
    if new.project_id is distinct from old.project_id then
      raise exception 'Incidents cannot move between projects.' using errcode = '42501';
    end if;
    if new.impact is distinct from old.impact then
      null;
    elsif new.severity is distinct from old.severity and public.severity_to_impact(new.severity) is not null then
      new.impact := public.severity_to_impact(new.severity);
    end if;
    if new.status is distinct from old.status then
      if old.status = 'draft' then new.published_at := coalesce(new.published_at, now()); end if;
      if new.status = 'resolved' then new.resolved_at := now(); end if;
      if old.status = 'resolved' and new.status <> 'resolved' then new.resolved_at := null; end if;
      if new.status = 'draft' and old.status <> 'draft' then
        raise exception 'A published incident cannot go back to draft.' using errcode = '22023';
      end if;
    end if;
  end if;
  new.severity := public.impact_to_severity(new.impact);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists incidents_before_write on public.incidents;
create trigger incidents_before_write before insert or update on public.incidents
for each row execute procedure public.incidents_before_write();

create or replace function public.incidents_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component uuid;
  v_reason text;
  v_messages text[] := '{}';
begin
  if new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at then
    v_reason := case when new.status = 'resolved' or new.deleted_at is not null then 'incident_resolved' else 'incident' end;
    for v_component in select component_id from public.incident_components where incident_id = new.id loop
      perform public.recompute_component_status(v_component, v_reason, new.id);
    end loop;
  end if;

  if new.title is distinct from old.title then
    v_messages := v_messages || format('Title changed from "%s" to "%s".', old.title, new.title);
  end if;
  if new.impact is distinct from old.impact then
    v_messages := v_messages || format('Impact changed from %s to %s.', old.impact, new.impact);
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    v_messages := v_messages || 'Incident deleted.'::text;
  end if;
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    v_messages := v_messages || coalesce('Acknowledged by ' || (select coalesce(nullif(p.name, ''), p.username) from public.profiles p where p.id = new.acknowledged_by) || '.', 'Acknowledged.');
  end if;
  if array_length(v_messages, 1) > 0 then
    insert into public.incident_updates (incident_id, kind, visibility, status, message, created_by)
    values (new.id, 'system', 'internal', new.status, array_to_string(v_messages, ' '), auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists incidents_after_update on public.incidents;
create trigger incidents_after_update after update on public.incidents
for each row execute procedure public.incidents_after_update();

create or replace function public.incident_components_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident uuid := coalesce(new.incident_id, old.incident_id);
  v_component uuid := coalesce(new.component_id, old.component_id);
  v_status text;
begin
  update public.incidents
  set component_ids = coalesce((select array_agg(ic.component_id order by ic.component_id) from public.incident_components ic where ic.incident_id = v_incident), '{}'::uuid[])
  where id = v_incident;

  select status into v_status from public.incidents where id = v_incident;
  perform public.recompute_component_status(v_component, case when v_status = 'resolved' or tg_op = 'DELETE' then 'incident_resolved' else 'incident' end, v_incident);
  return null;
end;
$$;

drop trigger if exists incident_components_after_change on public.incident_components;
create trigger incident_components_after_change after insert or update or delete on public.incident_components
for each row execute procedure public.incident_components_after_change();

-- ------------------------------------------------------------------
-- Maintenance triggers
-- ------------------------------------------------------------------
create or replace function public.maintenances_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Maintenance windows cannot move between projects.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('completed', 'cancelled') then
        raise exception 'This maintenance window is already closed.' using errcode = '22023';
      end if;
      if new.status = 'in_progress' then new.actual_start := coalesce(new.actual_start, now()); end if;
      if new.status in ('completed', 'cancelled') then new.actual_end := coalesce(new.actual_end, now()); end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists maintenances_before_write on public.maintenances;
create trigger maintenances_before_write before insert or update on public.maintenances
for each row execute procedure public.maintenances_before_write();

create or replace function public.maintenances_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component uuid;
begin
  for v_component in select component_id from public.maintenance_components where maintenance_id = new.id loop
    perform public.recompute_component_status(v_component, 'maintenance', null);
  end loop;
  if new.status in ('in_progress', 'completed', 'cancelled') then
    perform public.emit_maintenance_event(new.id, case new.status when 'in_progress' then 'maintenance_started' when 'completed' then 'maintenance_completed' else 'maintenance_cancelled' end);
  end if;
  return null;
end;
$$;

drop trigger if exists maintenances_after_status_change on public.maintenances;
create trigger maintenances_after_status_change after update on public.maintenances
for each row when (old.status is distinct from new.status)
execute procedure public.maintenances_after_status_change();

create or replace function public.maintenance_components_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_component_status(coalesce(new.component_id, old.component_id), 'maintenance', null);
  return null;
end;
$$;

drop trigger if exists maintenance_components_after_change on public.maintenance_components;
create trigger maintenance_components_after_change after insert or delete on public.maintenance_components
for each row execute procedure public.maintenance_components_after_change();

drop trigger if exists touch_incident_templates_updated_at on public.incident_templates;
create trigger touch_incident_templates_updated_at before update on public.incident_templates
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_postmortems_updated_at on public.postmortems;
create trigger touch_postmortems_updated_at before update on public.postmortems
for each row execute procedure public.touch_updated_at();

-- ------------------------------------------------------------------
-- Event helpers for incidents and maintenance (team alerts + subscribers)
-- ------------------------------------------------------------------
create or replace function public.incident_event_payload(p_incident_id uuid, p_event_type text, p_message text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'project_id', p.id,
    'project_name', p.name,
    'event_type', p_event_type,
    'status', i.status,
    'severity', i.impact,
    'reason', coalesce(nullif(p_message, ''), i.title),
    'occurred_at', now(),
    'dashboard_path', format('/p/%s/incidents/%s', p.id, i.id),
    'status_page_path', format('/status/%s/%s/incidents/%s', o.slug, p.slug, i.id),
    'incident', jsonb_build_object(
      'id', i.id, 'title', i.title, 'status', i.status, 'impact', i.impact,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', ic.status) order by c.position, c.name)
        from public.incident_components ic join public.components c on c.id = ic.component_id
        where ic.incident_id = i.id
      ), '[]'::jsonb)
    ),
    'message', p_message
  )
  from public.incidents i
  join public.projects p on p.id = i.project_id
  join public.organizations o on o.id = p.organization_id
  where i.id = p_incident_id
$$;

create or replace function public.emit_incident_event(p_incident_id uuid, p_event_type text, p_message text, p_notify_subscribers boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
  v_payload jsonb;
  v_components uuid[];
begin
  if public.events_suppressed() then return; end if;
  select * into v_incident from public.incidents where id = p_incident_id;
  v_payload := public.incident_event_payload(p_incident_id, p_event_type, p_message);
  perform public.enqueue_alert_event_and_dispatch(
    v_incident.project_id, p_event_type, 'incident', p_incident_id::text, v_incident.impact,
    format('incident:%s:%s', p_incident_id, p_event_type), v_payload
  );
  if p_notify_subscribers and p_event_type in ('incident_created', 'incident_updated', 'incident_resolved') then
    select coalesce(array_agg(component_id), '{}'::uuid[]) into v_components from public.incident_components where incident_id = p_incident_id;
    perform public.enqueue_subscriber_notification(v_incident.project_id, p_event_type, p_incident_id, v_components, v_payload);
  end if;
end;
$$;

create or replace function public.emit_maintenance_event(p_maintenance_id uuid, p_event_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maintenance public.maintenances;
  v_payload jsonb;
  v_components uuid[];
begin
  if public.events_suppressed() then return; end if;
  select * into v_maintenance from public.maintenances where id = p_maintenance_id;
  select coalesce(array_agg(component_id), '{}'::uuid[]) into v_components from public.maintenance_components where maintenance_id = p_maintenance_id;
  select jsonb_build_object(
    'project_id', p.id,
    'project_name', p.name,
    'event_type', p_event_type,
    'status', m.status,
    'severity', 'maintenance',
    'reason', m.title,
    'occurred_at', now(),
    'dashboard_path', format('/p/%s/maintenance/%s', p.id, m.id),
    'status_page_path', format('/status/%s/%s/maintenance/%s', o.slug, p.slug, m.id),
    'maintenance', jsonb_build_object(
      'id', m.id, 'title', m.title, 'description', m.description, 'status', m.status,
      'scheduled_start', m.scheduled_start, 'scheduled_end', m.scheduled_end,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.position, c.name)
        from public.maintenance_components mc join public.components c on c.id = mc.component_id
        where mc.maintenance_id = m.id
      ), '[]'::jsonb)
    )
  ) into v_payload
  from public.maintenances m
  join public.projects p on p.id = m.project_id
  join public.organizations o on o.id = p.organization_id
  where m.id = p_maintenance_id;

  if p_event_type <> 'maintenance_reminder' then
    perform public.enqueue_alert_event_and_dispatch(
      v_maintenance.project_id, p_event_type, 'maintenance', p_maintenance_id::text, 'maintenance',
      format('maintenance:%s:%s', p_maintenance_id, p_event_type), v_payload
    );
  end if;
  if v_maintenance.notify_subscribers then
    perform public.enqueue_subscriber_notification(v_maintenance.project_id, p_event_type, p_maintenance_id, v_components, v_payload);
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- RPCs: incidents
-- ------------------------------------------------------------------
create or replace function public.assert_project_role(p_project_id uuid, p_min_role text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_trusted_caller() then
    return;
  end if;
  if not public.has_project_role(p_project_id, p_min_role) then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.apply_incident_components(p_incident_id uuid, p_project_id uuid, p_components jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
  v_component_id uuid;
begin
  if p_components is null or jsonb_typeof(p_components) <> 'object' then
    return;
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_components) loop
    select id into v_component_id from public.components
    where project_id = p_project_id and (id::text = v_key or slug = lower(v_key));
    if v_component_id is null then
      raise exception 'Component % was not found in this status page.', v_key using errcode = 'P0002';
    end if;
    if v_value is null or jsonb_typeof(v_value) = 'null' then
      delete from public.incident_components where incident_id = p_incident_id and component_id = v_component_id;
    elsif jsonb_typeof(v_value) = 'string' and public.is_component_status(v_value #>> '{}') then
      insert into public.incident_components (incident_id, component_id, status)
      values (p_incident_id, v_component_id, v_value #>> '{}')
      on conflict (incident_id, component_id) do update set status = excluded.status, updated_at = now()
      where incident_components.status is distinct from excluded.status;
    else
      raise exception 'Invalid status for component %.', v_key using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.incident_component_snapshot(p_incident_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(component_id::text, status), '{}'::jsonb)
  from public.incident_components where incident_id = p_incident_id
$$;

create or replace function public.create_incident(
  p_project_id uuid,
  p_title text,
  p_message text,
  p_status text default 'investigating',
  p_impact text default 'minor',
  p_components jsonb default '{}'::jsonb,
  p_notify_subscribers boolean default true,
  p_source text default 'manual',
  p_actor_label text default null,
  p_source_monitor_id uuid default null,
  p_detected_at timestamptz default null
)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  perform public.assert_project_role(p_project_id, 'responder');
  if p_title is null or char_length(trim(p_title)) = 0 or char_length(p_title) > 200 then
    raise exception 'Give the incident a title of up to 200 characters.' using errcode = '22023';
  end if;
  if p_status not in ('draft', 'investigating', 'identified', 'monitoring', 'resolved') then
    raise exception 'Invalid incident status %.', p_status using errcode = '22023';
  end if;
  if p_impact not in ('none', 'minor', 'major', 'critical') then
    raise exception 'Invalid incident impact %.', p_impact using errcode = '22023';
  end if;

  insert into public.incidents (project_id, title, description, status, impact, source, source_monitor_id, created_by, detected_at)
  values (p_project_id, trim(p_title), coalesce(v_message, ''), p_status, p_impact, coalesce(p_source, 'manual'), p_source_monitor_id, auth.uid(), coalesce(p_detected_at, now()))
  returning * into v_incident;

  perform public.apply_incident_components(v_incident.id, p_project_id, p_components);

  insert into public.incident_updates (incident_id, kind, visibility, status, message, component_statuses, notify_subscribers, created_by, actor_label)
  values (
    v_incident.id, 'update', case when p_status = 'draft' then 'internal' else 'public' end, p_status,
    coalesce(v_message, case when p_status = 'draft' then 'Draft created.' else 'We are investigating this issue.' end),
    public.incident_component_snapshot(v_incident.id),
    p_notify_subscribers and p_status <> 'draft',
    auth.uid(), p_actor_label
  );

  perform public.emit_incident_event(
    v_incident.id,
    case when p_status = 'draft' then 'incident_draft_created' else 'incident_created' end,
    coalesce(v_message, trim(p_title)),
    p_notify_subscribers and p_status <> 'draft'
  );

  select * into v_incident from public.incidents where id = v_incident.id;
  return v_incident;
end;
$$;

create or replace function public.post_incident_update(
  p_incident_id uuid,
  p_status text,
  p_message text,
  p_visibility text default 'public',
  p_components jsonb default null,
  p_notify_subscribers boolean default true,
  p_actor_label text default null
)
returns public.incident_updates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
  v_update public.incident_updates;
  v_previous_status text;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_event text;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then
    raise exception 'Incident not found.' using errcode = 'P0002';
  end if;
  perform public.assert_project_role(v_incident.project_id, 'responder');
  if v_message is null then
    raise exception 'Write a message for the update.' using errcode = '22023';
  end if;

  if p_visibility = 'internal' then
    insert into public.incident_updates (incident_id, kind, visibility, status, message, created_by, actor_label)
    values (p_incident_id, 'note', 'internal', v_incident.status, v_message, auth.uid(), p_actor_label)
    returning * into v_update;
    return v_update;
  elsif p_visibility <> 'public' then
    raise exception 'Visibility must be public or internal.' using errcode = '22023';
  end if;

  if p_status is null then p_status := v_incident.status; end if;
  if p_status not in ('investigating', 'identified', 'monitoring', 'resolved') then
    raise exception 'Invalid incident status %.', p_status using errcode = '22023';
  end if;

  v_previous_status := v_incident.status;
  perform public.apply_incident_components(p_incident_id, v_incident.project_id, p_components);
  if p_status is distinct from v_incident.status then
    update public.incidents set status = p_status where id = p_incident_id;
  end if;

  insert into public.incident_updates (incident_id, kind, visibility, status, message, component_statuses, notify_subscribers, created_by, actor_label)
  values (p_incident_id, 'update', 'public', p_status, v_message, public.incident_component_snapshot(p_incident_id), coalesce(p_notify_subscribers, true), auth.uid(), p_actor_label)
  returning * into v_update;

  v_event := case
    when v_previous_status = 'draft' then 'incident_created'
    when p_status = 'resolved' then 'incident_resolved'
    else 'incident_updated'
  end;
  perform public.emit_incident_event(p_incident_id, v_event, v_message, coalesce(p_notify_subscribers, true));

  if p_status = 'resolved' and v_previous_status <> 'resolved' then
    perform public.ensure_postmortem_draft(p_incident_id, false);
  end if;

  return v_update;
end;
$$;

create or replace function public.update_incident_details(p_incident_id uuid, p_title text default null, p_impact text default null)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_incident.project_id, 'responder');
  if p_impact is not null and p_impact not in ('none', 'minor', 'major', 'critical') then
    raise exception 'Invalid incident impact %.', p_impact using errcode = '22023';
  end if;
  if p_title is not null and (char_length(trim(p_title)) = 0 or char_length(p_title) > 200) then
    raise exception 'Give the incident a title of up to 200 characters.' using errcode = '22023';
  end if;
  update public.incidents
  set title = coalesce(nullif(trim(p_title), ''), title), impact = coalesce(p_impact, impact)
  where id = p_incident_id
  returning * into v_incident;
  return v_incident;
end;
$$;

create or replace function public.acknowledge_incident(p_incident_id uuid)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_incident.project_id, 'responder');
  if v_incident.acknowledged_at is null then
    update public.incidents set acknowledged_at = now(), acknowledged_by = auth.uid() where id = p_incident_id returning * into v_incident;
  end if;
  return v_incident;
end;
$$;

create or replace function public.delete_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_incident.project_id, 'admin');
  update public.incidents set deleted_at = now() where id = p_incident_id;
end;
$$;

create or replace function public.ensure_postmortem_draft(p_incident_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
  v_project public.projects;
  v_id uuid;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if not p_force then
    select * into v_project from public.projects where id = v_incident.project_id;
    if not v_project.auto_postmortem or v_incident.impact not in ('major', 'critical') then
      return null;
    end if;
  else
    perform public.assert_project_role(v_incident.project_id, 'responder');
  end if;
  select id into v_id from public.postmortems where incident_id = p_incident_id;
  if v_id is not null then return v_id; end if;
  insert into public.postmortems (incident_id, project_id, title, timeline, created_by)
  values (
    p_incident_id, v_incident.project_id, 'Postmortem: ' || v_incident.title,
    coalesce((
      select jsonb_agg(jsonb_build_object('at', u.created_at, 'kind', u.kind, 'visibility', u.visibility, 'status', u.status, 'message', u.message) order by u.created_at)
      from public.incident_updates u where u.incident_id = p_incident_id
    ), '[]'::jsonb),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------------
-- RPCs: components and maintenance
-- ------------------------------------------------------------------
create or replace function public.set_component_manual_status(p_component_id uuid, p_status text)
returns public.components
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component public.components;
begin
  select * into v_component from public.components where id = p_component_id;
  if not found then raise exception 'Component not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_component.project_id, 'responder');
  if p_status is not null and not public.is_component_status(p_status) then
    raise exception 'Invalid component status %.', p_status using errcode = '22023';
  end if;
  update public.components set manual_status = p_status where id = p_component_id;
  select * into v_component from public.components where id = p_component_id;
  return v_component;
end;
$$;

create or replace function public.create_maintenance(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_component_ids uuid[] default '{}'::uuid[],
  p_auto_start boolean default true,
  p_auto_complete boolean default true,
  p_notify_subscribers boolean default true,
  p_reminder_minutes integer default 1440,
  p_mute_alerts boolean default true,
  p_actor_label text default null
)
returns public.maintenances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maintenance public.maintenances;
  v_component uuid;
begin
  perform public.assert_project_role(p_project_id, 'responder');
  if p_scheduled_end <= p_scheduled_start then
    raise exception 'The window must end after it starts.' using errcode = '22023';
  end if;
  insert into public.maintenances (project_id, title, description, scheduled_start, scheduled_end, auto_start, auto_complete, notify_subscribers, reminder_minutes, mute_alerts, created_by)
  values (p_project_id, trim(p_title), coalesce(p_description, ''), p_scheduled_start, p_scheduled_end, p_auto_start, p_auto_complete, p_notify_subscribers, coalesce(p_reminder_minutes, 1440), p_mute_alerts, auth.uid())
  returning * into v_maintenance;
  foreach v_component in array coalesce(p_component_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.components where id = v_component and project_id = p_project_id) then
      raise exception 'Component % was not found in this status page.', v_component using errcode = 'P0002';
    end if;
    insert into public.maintenance_components (maintenance_id, component_id) values (v_maintenance.id, v_component) on conflict do nothing;
  end loop;
  insert into public.maintenance_updates (maintenance_id, status, message, created_by, actor_label)
  values (v_maintenance.id, 'scheduled', coalesce(nullif(trim(p_description), ''), 'Maintenance scheduled.'), auth.uid(), p_actor_label);
  perform public.emit_maintenance_event(v_maintenance.id, 'maintenance_scheduled');
  if p_scheduled_start <= now() and p_auto_start then
    update public.maintenances set status = 'in_progress' where id = v_maintenance.id;
    insert into public.maintenance_updates (maintenance_id, status, message, created_by, actor_label)
    values (v_maintenance.id, 'in_progress', 'Maintenance started.', auth.uid(), p_actor_label);
  end if;
  select * into v_maintenance from public.maintenances where id = v_maintenance.id;
  return v_maintenance;
end;
$$;

create or replace function public.update_maintenance(
  p_maintenance_id uuid,
  p_title text default null,
  p_description text default null,
  p_scheduled_start timestamptz default null,
  p_scheduled_end timestamptz default null,
  p_component_ids uuid[] default null,
  p_auto_start boolean default null,
  p_auto_complete boolean default null,
  p_notify_subscribers boolean default null,
  p_reminder_minutes integer default null,
  p_mute_alerts boolean default null
)
returns public.maintenances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maintenance public.maintenances;
  v_component uuid;
begin
  select * into v_maintenance from public.maintenances where id = p_maintenance_id for update;
  if not found then raise exception 'Maintenance window not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_maintenance.project_id, 'responder');
  if v_maintenance.status in ('completed', 'cancelled') then
    raise exception 'This maintenance window is already closed.' using errcode = '22023';
  end if;
  update public.maintenances set
    title = coalesce(nullif(trim(p_title), ''), title),
    description = coalesce(p_description, description),
    scheduled_start = coalesce(p_scheduled_start, scheduled_start),
    scheduled_end = coalesce(p_scheduled_end, scheduled_end),
    auto_start = coalesce(p_auto_start, auto_start),
    auto_complete = coalesce(p_auto_complete, auto_complete),
    notify_subscribers = coalesce(p_notify_subscribers, notify_subscribers),
    reminder_minutes = coalesce(p_reminder_minutes, reminder_minutes),
    reminder_sent_at = case when p_scheduled_start is not null and p_scheduled_start <> scheduled_start then null else reminder_sent_at end,
    mute_alerts = coalesce(p_mute_alerts, mute_alerts)
  where id = p_maintenance_id
  returning * into v_maintenance;
  if p_component_ids is not null then
    delete from public.maintenance_components where maintenance_id = p_maintenance_id and component_id <> all(p_component_ids);
    foreach v_component in array p_component_ids loop
      if not exists (select 1 from public.components where id = v_component and project_id = v_maintenance.project_id) then
        raise exception 'Component % was not found in this status page.', v_component using errcode = 'P0002';
      end if;
      insert into public.maintenance_components (maintenance_id, component_id) values (p_maintenance_id, v_component) on conflict do nothing;
    end loop;
  end if;
  return v_maintenance;
end;
$$;

create or replace function public.set_maintenance_status(p_maintenance_id uuid, p_status text, p_message text default null, p_actor_label text default null)
returns public.maintenances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maintenance public.maintenances;
begin
  select * into v_maintenance from public.maintenances where id = p_maintenance_id for update;
  if not found then raise exception 'Maintenance window not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_maintenance.project_id, 'responder');
  if p_status not in ('in_progress', 'completed', 'cancelled') then
    raise exception 'Invalid maintenance status %.', p_status using errcode = '22023';
  end if;
  if v_maintenance.status = p_status then
    return v_maintenance;
  end if;
  if p_status = 'completed' and v_maintenance.status = 'scheduled' then
    raise exception 'Start the maintenance before completing it, or cancel it.' using errcode = '22023';
  end if;
  update public.maintenances set status = p_status where id = p_maintenance_id returning * into v_maintenance;
  insert into public.maintenance_updates (maintenance_id, status, message, created_by, actor_label)
  values (p_maintenance_id, p_status, coalesce(nullif(trim(p_message), ''), case p_status
    when 'in_progress' then 'Maintenance started.'
    when 'completed' then 'Maintenance completed.'
    else 'Maintenance cancelled.'
  end), auth.uid(), p_actor_label);
  return v_maintenance;
end;
$$;

create or replace function public.post_maintenance_update(p_maintenance_id uuid, p_message text, p_actor_label text default null)
returns public.maintenance_updates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maintenance public.maintenances;
  v_update public.maintenance_updates;
begin
  select * into v_maintenance from public.maintenances where id = p_maintenance_id;
  if not found then raise exception 'Maintenance window not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_maintenance.project_id, 'responder');
  if nullif(trim(coalesce(p_message, '')), '') is null then
    raise exception 'Write a message for the update.' using errcode = '22023';
  end if;
  insert into public.maintenance_updates (maintenance_id, status, message, created_by, actor_label)
  values (p_maintenance_id, v_maintenance.status, trim(p_message), auth.uid(), p_actor_label)
  returning * into v_update;
  return v_update;
end;
$$;

create or replace function public.process_maintenance_windows()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.maintenances
    where status = 'scheduled' and auto_start and scheduled_start <= now()
    for update skip locked
  loop
    update public.maintenances set status = 'in_progress' where id = v_row.id;
    insert into public.maintenance_updates (maintenance_id, status, message) values (v_row.id, 'in_progress', 'Maintenance started.');
    v_count := v_count + 1;
  end loop;

  for v_row in
    select id from public.maintenances
    where status = 'in_progress' and auto_complete and scheduled_end <= now()
    for update skip locked
  loop
    update public.maintenances set status = 'completed' where id = v_row.id;
    insert into public.maintenance_updates (maintenance_id, status, message) values (v_row.id, 'completed', 'Maintenance completed.');
    v_count := v_count + 1;
  end loop;

  for v_row in
    select id from public.maintenances
    where status = 'scheduled' and notify_subscribers and reminder_sent_at is null and reminder_minutes > 0
      and scheduled_start - make_interval(mins => reminder_minutes) <= now() and scheduled_start > now()
      and created_at < scheduled_start - make_interval(mins => reminder_minutes)
    for update skip locked
  loop
    update public.maintenances set reminder_sent_at = now() where id = v_row.id;
    perform public.emit_maintenance_event(v_row.id, 'maintenance_reminder');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ------------------------------------------------------------------
-- Settle every component once with the new rules (no alerts for the migration itself)
-- ------------------------------------------------------------------
do $$
declare
  v_component uuid;
begin
  perform set_config('upvane.suppress_events', 'on', true);
  for v_component in select id from public.components loop
    perform public.recompute_component_status(v_component, 'system', null);
  end loop;
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
    'public.recompute_component_status(uuid, text, uuid)',
    'public.emit_component_transition(uuid, text, text, text)',
    'public.emit_incident_event(uuid, text, text, boolean)',
    'public.emit_maintenance_event(uuid, text)',
    'public.incident_event_payload(uuid, text, text)',
    'public.apply_incident_components(uuid, uuid, jsonb)',
    'public.process_maintenance_windows()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.create_incident(uuid, text, text, text, text, jsonb, boolean, text, text, uuid, timestamptz)',
    'public.post_incident_update(uuid, text, text, text, jsonb, boolean, text)',
    'public.update_incident_details(uuid, text, text)',
    'public.acknowledge_incident(uuid)',
    'public.delete_incident(uuid)',
    'public.ensure_postmortem_draft(uuid, boolean)',
    'public.set_component_manual_status(uuid, text)',
    'public.create_maintenance(uuid, text, text, timestamptz, timestamptz, uuid[], boolean, boolean, boolean, integer, boolean, text)',
    'public.update_maintenance(uuid, text, text, timestamptz, timestamptz, uuid[], boolean, boolean, boolean, integer, boolean)',
    'public.set_maintenance_status(uuid, text, text, text)',
    'public.post_maintenance_update(uuid, text, text)',
    'public.incident_component_snapshot(uuid)',
    'public.assert_project_role(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end $$;
