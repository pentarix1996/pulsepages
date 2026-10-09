-- ==========================================
-- Migration: v2 uptime, daily status, SLOs, MTTA/MTTR and plan enforcement
-- ==========================================
-- Uptime starts at max(window start, component creation) (A-3), uses the status that was active when the window
-- opened, weights partial outages (major 1.0, partial 0.3, degraded 0 by default) and is computed in SQL.

create table if not exists public.slos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  component_id uuid references public.components(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  target numeric(6, 3) not null check (target > 0 and target < 100),
  window_days integer not null default 30 check (window_days in (7, 14, 28, 30, 90)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists slos_project_idx on public.slos (project_id);
alter table public.slos enable row level security;

drop trigger if exists touch_slos_updated_at on public.slos;
create trigger touch_slos_updated_at before update on public.slos
for each row execute procedure public.touch_updated_at();

insert into public.slos (project_id, name, target, window_days)
select p.id, 'Status page availability', 99.9, 30 from public.projects p
where not exists (select 1 from public.slos s where s.project_id = p.id);

-- New projects: alert defaults (defined in the alerts migration) and a default SLO.
drop trigger if exists projects_after_insert_defaults on public.projects;
create trigger projects_after_insert_defaults after insert on public.projects
for each row execute procedure public.projects_after_insert_defaults();

-- ------------------------------------------------------------------
-- Intervals and uptime
-- ------------------------------------------------------------------
create or replace function public.status_weight(p_weights jsonb, p_status text)
returns numeric
language sql
immutable
as $$
  select case p_status
    when 'major_outage' then coalesce((p_weights->>'major_outage')::numeric, 1)
    when 'partial_outage' then coalesce((p_weights->>'partial_outage')::numeric, 0.3)
    when 'degraded' then coalesce((p_weights->>'degraded')::numeric, 0)
    else 0
  end
$$;

create or replace function public.component_status_intervals(p_component_id uuid, p_from timestamptz, p_to timestamptz)
returns table(status text, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select greatest(p_from, c.created_at) as from_at, p_to as to_at
    from public.components c where c.id = p_component_id
  ),
  points as (
    select coalesce((
      select h.status from public.component_status_history h, bounds b
      where h.component_id = p_component_id and h.changed_at <= b.from_at
      order by h.changed_at desc limit 1
    ), 'operational') as status, b.from_at as start_at
    from bounds b
    union all
    select h.status, h.changed_at
    from public.component_status_history h, bounds b
    where h.component_id = p_component_id and h.changed_at > b.from_at and h.changed_at < b.to_at
  ),
  ordered as (
    select p.status, p.start_at, lead(p.start_at, 1, (select to_at from bounds)) over (order by p.start_at) as end_at
    from points p
  )
  select o.status, o.start_at, o.end_at from ordered o where o.end_at > o.start_at
$$;

create or replace function public.component_downtime_seconds(p_component_id uuid, p_from timestamptz, p_to timestamptz)
returns table(total_seconds numeric, weighted_downtime_seconds numeric, major_seconds numeric, partial_seconds numeric, degraded_seconds numeric, maintenance_seconds numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(extract(epoch from (i.end_at - i.start_at))), 0),
    coalesce(sum(extract(epoch from (i.end_at - i.start_at)) * public.status_weight(p.uptime_weights, i.status)), 0),
    coalesce(sum(extract(epoch from (i.end_at - i.start_at))) filter (where i.status = 'major_outage'), 0),
    coalesce(sum(extract(epoch from (i.end_at - i.start_at))) filter (where i.status = 'partial_outage'), 0),
    coalesce(sum(extract(epoch from (i.end_at - i.start_at))) filter (where i.status = 'degraded'), 0),
    coalesce(sum(extract(epoch from (i.end_at - i.start_at))) filter (where i.status = 'maintenance'), 0)
  from public.component_status_intervals(p_component_id, p_from, p_to) i
  join public.components c on c.id = p_component_id
  join public.projects p on p.id = c.project_id
$$;

create or replace function public.component_uptime(p_component_id uuid, p_from timestamptz, p_to timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when d.total_seconds <= 0 then 100.0
              else round(greatest(0, 100 - (d.weighted_downtime_seconds / d.total_seconds) * 100), 3) end
  from public.component_downtime_seconds(p_component_id, p_from, p_to) d
$$;

-- One row per component and day (in p_timezone) with the worst status, weighted downtime and incidents.
create or replace function public.component_daily_status(p_component_ids uuid[], p_days integer, p_timezone text default 'UTC')
returns table(component_id uuid, day date, worst_status text, downtime_seconds numeric, major_seconds numeric, partial_seconds numeric, degraded_seconds numeric, maintenance_seconds numeric, incident_ids uuid[], has_data boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(p_timezone, ''), 'UTC');
  v_today date;
  v_from timestamptz;
begin
  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_tz := 'UTC';
    v_today := (now() at time zone 'UTC')::date;
  end;
  v_from := ((v_today - (greatest(p_days, 1) - 1))::timestamp at time zone v_tz);

  return query
  with days as (
    select d::date as day,
           (d::date::timestamp at time zone v_tz) as day_start,
           least(((d::date + 1)::timestamp at time zone v_tz), now()) as day_end
    from generate_series(v_today - (greatest(p_days, 1) - 1), v_today, interval '1 day') d
  ),
  comps as (
    select c.id, c.created_at, p.uptime_weights from public.components c join public.projects p on p.id = c.project_id
    where c.id = any(p_component_ids)
  ),
  intervals as (
    select c.id as component_id, i.status, i.start_at, i.end_at, c.uptime_weights
    from comps c cross join lateral public.component_status_intervals(c.id, v_from, now()) i
  ),
  day_overlaps as (
    select d.day, iv.component_id, iv.status, iv.uptime_weights,
           extract(epoch from (least(iv.end_at, d.day_end) - greatest(iv.start_at, d.day_start))) as seconds
    from days d join intervals iv on iv.start_at < d.day_end and iv.end_at > d.day_start
  ),
  agg as (
    select o.component_id, o.day,
      (array_agg(o.status order by public.status_rank(o.status) desc))[1] as worst,
      sum(o.seconds * public.status_weight(o.uptime_weights, o.status)) as downtime,
      coalesce(sum(o.seconds) filter (where o.status = 'major_outage'), 0) as major,
      coalesce(sum(o.seconds) filter (where o.status = 'partial_outage'), 0) as partial,
      coalesce(sum(o.seconds) filter (where o.status = 'degraded'), 0) as degraded,
      coalesce(sum(o.seconds) filter (where o.status = 'maintenance'), 0) as maint
    from day_overlaps o where o.seconds > 0
    group by o.component_id, o.day
  ),
  incidents_by_day as (
    select ic.component_id, d.day, array_agg(distinct i.id) as ids
    from days d
    join public.incidents i on coalesce(i.published_at, i.created_at) < d.day_end and coalesce(i.resolved_at, now()) > d.day_start
    join public.incident_components ic on ic.incident_id = i.id
    where ic.component_id = any(p_component_ids) and i.deleted_at is null and i.status <> 'draft'
    group by ic.component_id, d.day
  )
  select c.id, d.day,
         case when d.day_end <= c.created_at then null else coalesce(a.worst, 'operational') end,
         coalesce(a.downtime, 0), coalesce(a.major, 0), coalesce(a.partial, 0), coalesce(a.degraded, 0), coalesce(a.maint, 0),
         coalesce(ibd.ids, '{}'::uuid[]),
         d.day_end > c.created_at
  from comps c cross join days d
  left join agg a on a.component_id = c.id and a.day = d.day
  left join incidents_by_day ibd on ibd.component_id = c.id and ibd.day = d.day
  order by c.id, d.day;
end;
$$;

-- ------------------------------------------------------------------
-- Project metrics: uptime, incidents, MTTA, MTTR, SLO error budgets
-- ------------------------------------------------------------------
create or replace function public.get_project_metrics(p_project_id uuid, p_from timestamptz, p_to timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_trusted_caller() and not public.has_project_role(p_project_id, 'viewer') then
    raise exception 'You do not have access to this status page.' using errcode = '42501';
  end if;

  with comps as (
    select c.id, c.name, c.slug, c.status, c.group_id, c.position from public.components c where c.project_id = p_project_id
  ),
  uptime as (
    select c.id, c.name, c.slug, c.status, d.total_seconds, d.weighted_downtime_seconds, d.major_seconds, d.partial_seconds, d.degraded_seconds, d.maintenance_seconds,
           case when d.total_seconds <= 0 then 100.0 else round(greatest(0, 100 - d.weighted_downtime_seconds / d.total_seconds * 100), 3) end as uptime
    from comps c cross join lateral public.component_downtime_seconds(c.id, p_from, p_to) d
  ),
  incs as (
    select i.* from public.incidents i
    where i.project_id = p_project_id and i.deleted_at is null and i.status <> 'draft'
      and i.detected_at >= p_from and i.detected_at < p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'uptime', coalesce((select round(avg(uptime), 3) from uptime), 100),
    'components', coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.name, 'slug', u.slug, 'status', u.status, 'uptime', u.uptime,
      'downtime_seconds', round(u.weighted_downtime_seconds), 'major_seconds', round(u.major_seconds),
      'partial_seconds', round(u.partial_seconds), 'degraded_seconds', round(u.degraded_seconds),
      'maintenance_seconds', round(u.maintenance_seconds)
    ) order by u.name) from uptime u), '[]'::jsonb),
    'incidents', jsonb_build_object(
      'total', (select count(*) from incs),
      'by_impact', coalesce((select jsonb_object_agg(impact, n) from (select impact, count(*) n from incs group by impact) x), '{}'::jsonb),
      'mtta_seconds', (select round(avg(extract(epoch from (acknowledged_at - detected_at)))) from incs where acknowledged_at is not null and acknowledged_at >= detected_at),
      'mttr_seconds', (select round(avg(extract(epoch from (resolved_at - detected_at)))) from incs where resolved_at is not null and resolved_at >= detected_at),
      'longest_seconds', (select round(max(extract(epoch from (coalesce(resolved_at, p_to) - detected_at)))) from incs),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'impact', i.impact, 'status', i.status, 'detected_at', i.detected_at,
        'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at,
        'duration_seconds', round(extract(epoch from (coalesce(i.resolved_at, p_to) - i.detected_at)))
      ) order by i.detected_at desc) from incs i), '[]'::jsonb)
    ),
    'slos', coalesce((select jsonb_agg(slo_row order by slo_name) from (
      select s.name as slo_name, jsonb_build_object(
        'id', s.id, 'name', s.name, 'target', s.target, 'window_days', s.window_days, 'component_id', s.component_id,
        'actual', w.actual,
        'allowed_downtime_seconds', round(w.window_seconds * (1 - s.target / 100)),
        'consumed_downtime_seconds', round(w.downtime_seconds),
        'budget_remaining', case when w.window_seconds * (1 - s.target / 100) <= 0 then 0
          else round(greatest(0, 1 - w.downtime_seconds / (w.window_seconds * (1 - s.target / 100))), 4) end
      ) as slo_row
      from public.slos s
      cross join lateral (
        select
          coalesce(avg(d.total_seconds), extract(epoch from make_interval(days => s.window_days))) as window_seconds,
          coalesce(avg(d.weighted_downtime_seconds), 0) as downtime_seconds,
          coalesce(round(avg(case when d.total_seconds <= 0 then 100.0 else greatest(0, 100 - d.weighted_downtime_seconds / d.total_seconds * 100) end), 4), 100) as actual
        from public.components c
        cross join lateral public.component_downtime_seconds(c.id, now() - make_interval(days => s.window_days), now()) d
        where c.project_id = p_project_id and (s.component_id is null or c.id = s.component_id)
      ) w
      where s.project_id = p_project_id
    ) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ------------------------------------------------------------------
-- Plan changes: pause what no longer fits, resume what fits again
-- ------------------------------------------------------------------
create or replace function public.enforce_plan_limits(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_limit integer;
  v_monitor record;
  v_active integer;
begin
  select plan into v_plan from public.organizations where id = p_organization_id;
  v_limit := public.plan_limit(v_plan, 'monitors');

  select count(*) into v_active from public.monitors m join public.projects p on p.id = m.project_id
  where p.organization_id = p_organization_id and m.enabled and m.paused_reason is null;

  if v_limit <> -1 and v_active > v_limit then
    for v_monitor in
      select m.id from public.monitors m join public.projects p on p.id = m.project_id
      where p.organization_id = p_organization_id and m.enabled and m.paused_reason is null
      order by m.created_at desc
      limit v_active - v_limit
    loop
      update public.monitors set paused_reason = 'plan_limit' where id = v_monitor.id;
    end loop;
  elsif v_limit = -1 or v_active < v_limit then
    for v_monitor in
      select m.id from public.monitors m join public.projects p on p.id = m.project_id
      where p.organization_id = p_organization_id and m.enabled and m.paused_reason = 'plan_limit'
      order by m.created_at asc
      limit case when v_limit = -1 then 100000 else v_limit - v_active end
    loop
      update public.monitors set paused_reason = null where id = v_monitor.id;
    end loop;
  end if;

  -- Re-run the monitor guard so intervals and regions are clamped to the plan.
  update public.monitors m set interval_seconds = m.interval_seconds
  from public.projects p where p.id = m.project_id and p.organization_id = p_organization_id;

  if public.plan_limit(v_plan, 'custom_domain') = 0 then
    update public.projects set custom_domain_status = 'suspended', hide_powered_by = false
    where organization_id = p_organization_id and custom_domain is not null and custom_domain_status = 'verified';
    update public.projects set hide_powered_by = false where organization_id = p_organization_id;
  else
    update public.projects set custom_domain_status = 'verified'
    where organization_id = p_organization_id and custom_domain_status = 'suspended' and custom_domain_verified_at is not null;
  end if;
end;
$$;

create or replace function public.organizations_after_plan_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_plan_limits(new.id);
  insert into public.audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id, metadata)
  values (new.id, case when auth.uid() is null then 'system' else 'user' end, auth.uid()::text, 'billing.plan_changed', 'organization', new.id::text,
          jsonb_build_object('from', old.plan, 'to', new.plan));
  return null;
end;
$$;

drop trigger if exists organizations_after_plan_change on public.organizations;
create trigger organizations_after_plan_change after update on public.organizations
for each row when (old.plan is distinct from new.plan)
execute procedure public.organizations_after_plan_change();

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.component_status_intervals(uuid, timestamptz, timestamptz)',
    'public.component_downtime_seconds(uuid, timestamptz, timestamptz)',
    'public.component_uptime(uuid, timestamptz, timestamptz)',
    'public.component_daily_status(uuid[], integer, text)',
    'public.enforce_plan_limits(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
  revoke execute on function public.get_project_metrics(uuid, timestamptz, timestamptz) from public, anon;
  grant execute on function public.get_project_metrics(uuid, timestamptz, timestamptz) to authenticated, service_role;
end $$;
