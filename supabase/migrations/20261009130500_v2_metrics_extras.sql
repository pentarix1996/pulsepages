-- ==========================================
-- Migration: v2 metrics extras (overview, reports, SLO guards) and project insert guards
-- ==========================================
-- The overview and the reports page read aggregates, never raw rows:
--   * get_project_uptime(project, days)              → 90-day bars + uptime per component, in the project timezone
--   * get_project_latency(project, from, to, bucket) → p50/p95 overall, per time bucket, per monitor, per component
--   * get_project_slos(project)                      → live error budget per SLO (same maths as get_project_metrics)
-- All three are security definer with an explicit membership check, so the dashboard (RLS-bound client) and the
-- public API (service role acting for a key) call them the same way.

-- ------------------------------------------------------------------
-- Projects: slugs are unique per organization (v2), not per creator
-- ------------------------------------------------------------------
-- The v1 index (user_id, slug) made a user unable to reuse a slug in a second organization.
drop index if exists public.projects_user_slug_key;

-- projects_guard_settings() only runs on UPDATE: apply the same plan gates when a project is created, so a Free
-- organization cannot insert a private or branded page directly, and nobody can insert a pre-verified domain.
create or replace function public.projects_guard_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan text;
begin
  if public.is_privileged_session() then
    return new;
  end if;
  select plan into v_plan from public.organizations where id = new.organization_id;
  if new.visibility = 'private' and public.plan_limit(v_plan, 'private_pages') = 0 then
    raise exception 'Private status pages require the Business plan.' using errcode = 'P0001';
  end if;
  if new.custom_domain is not null then
    if public.plan_limit(v_plan, 'custom_domain') = 0 then
      raise exception 'Custom domains require the Pro plan.' using errcode = 'P0001';
    end if;
    new.custom_domain := lower(new.custom_domain);
    new.custom_domain_status := 'pending';
  else
    new.custom_domain_status := 'none';
  end if;
  new.custom_domain_verified_at := null;
  new.custom_domain_error := null;
  if (coalesce(new.hide_powered_by, false) or new.brand_color is not null or new.logo_url is not null)
     and public.plan_limit(v_plan, 'custom_domain') = 0 then
    raise exception 'Branding requires the Pro plan.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Fires after check_project_limit_trigger (alphabetical order), which fills organization_id when it is missing.
drop trigger if exists projects_guard_insert on public.projects;
create trigger projects_guard_insert before insert on public.projects
for each row execute procedure public.projects_guard_insert();

-- ------------------------------------------------------------------
-- SLOs: a component SLO must point at a component of the same status page
-- ------------------------------------------------------------------
create or replace function public.slos_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'SLOs cannot move between status pages.' using errcode = '42501';
  end if;
  if new.component_id is not null and not exists (
    select 1 from public.components c where c.id = new.component_id and c.project_id = new.project_id
  ) then
    raise exception 'The component belongs to another status page.' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.slos s where s.project_id = new.project_id) >= 50 then
    raise exception 'A status page can have at most 50 SLOs.' using errcode = 'P0001';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

drop trigger if exists slos_guard on public.slos;
create trigger slos_guard before insert or update on public.slos
for each row execute procedure public.slos_guard();

-- ------------------------------------------------------------------
-- Uptime bars and uptime per component
-- ------------------------------------------------------------------
create or replace function public.get_project_uptime(p_project_id uuid, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 1), 365);
  v_timezone text;
  v_component_ids uuid[];
  v_result jsonb;
begin
  if not public.is_trusted_caller() and not public.has_project_role(p_project_id, 'viewer') then
    raise exception 'You do not have access to this status page.' using errcode = '42501';
  end if;
  select p.timezone into v_timezone from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'Status page not found.' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_component_ids from public.components c where c.project_id = p_project_id;

  with daily as (
    select * from public.component_daily_status(v_component_ids, v_days, v_timezone)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'component_id', c.id,
    'slug', c.slug,
    'name', c.name,
    'status', c.status,
    'group_id', c.group_id,
    'position', c.position,
    'uptime', public.component_uptime(c.id, now() - make_interval(days => v_days), now()),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'status', d.worst_status,
        'downtime_minutes', round(d.downtime_seconds / 60),
        'major_minutes', round(d.major_seconds / 60),
        'partial_minutes', round(d.partial_seconds / 60),
        'degraded_minutes', round(d.degraded_seconds / 60),
        'maintenance_minutes', round(d.maintenance_seconds / 60),
        'incidents', case when cardinality(d.incident_ids) = 0 then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'impact', i.impact) order by i.detected_at)
          from public.incidents i where i.id = any(d.incident_ids)
        ), '[]'::jsonb) end
      ) order by d.day)
      from daily d where d.component_id = c.id
    ), '[]'::jsonb)
  ) order by g.position nulls last, g.name, c.group_id, c.position, c.name), '[]'::jsonb)
  into v_result
  from public.components c
  left join public.component_groups g on g.id = c.group_id
  where c.project_id = p_project_id;

  return jsonb_build_object('timezone', v_timezone, 'days', v_days, 'components', v_result);
end;
$$;

-- ------------------------------------------------------------------
-- Latency percentiles from monitor_check_results (probe errors excluded)
-- ------------------------------------------------------------------
create or replace function public.get_project_latency(
  p_project_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_bucket_minutes integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_to timestamptz := least(coalesce(p_to, now()), now());
  v_from timestamptz := coalesce(p_from, least(coalesce(p_to, now()), now()) - interval '24 hours');
  v_bucket interval := make_interval(mins => least(greatest(coalesce(p_bucket_minutes, 60), 1), 1440));
  v_result jsonb;
begin
  if not public.is_trusted_caller() and not public.has_project_role(p_project_id, 'viewer') then
    raise exception 'You do not have access to this status page.' using errcode = '42501';
  end if;
  if v_from >= v_to then
    raise exception 'The start of the range must be before its end.' using errcode = '22023';
  end if;
  if v_to - v_from > interval '7 days' then
    raise exception 'Latency is available for ranges of up to 7 days.' using errcode = '22023';
  end if;
  if extract(epoch from (v_to - v_from)) / extract(epoch from v_bucket) > 1000 then
    raise exception 'Use a larger bucket for this range (at most 1000 buckets).' using errcode = '22023';
  end if;

  with samples as (
    select r.monitor_id, r.response_time_ms::double precision as ms, r.checked_at
    from public.monitor_check_results r
    where r.project_id = p_project_id
      and r.checked_at >= v_from and r.checked_at < v_to
      and r.monitor_id is not null
      and r.response_time_ms is not null
      and r.status in ('up', 'degraded', 'down')
  ),
  buckets as (
    select b as bucket_start from generate_series(v_from, v_to - interval '1 microsecond', v_bucket) b
  ),
  per_bucket as (
    select date_bin(v_bucket, s.checked_at, v_from) as bucket_start,
           percentile_cont(0.95) within group (order by s.ms) as p95,
           count(*) as n
    from samples s
    group by 1
  ),
  per_monitor as (
    select s.monitor_id,
           percentile_cont(0.5) within group (order by s.ms) as p50,
           percentile_cont(0.95) within group (order by s.ms) as p95,
           count(*) as n
    from samples s
    group by s.monitor_id
  ),
  per_component as (
    select mc.component_id,
           percentile_cont(0.95) within group (order by s.ms) as p95,
           count(*) as n
    from samples s
    join public.monitor_components mc on mc.monitor_id = s.monitor_id
    group by mc.component_id
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'bucket_minutes', (extract(epoch from v_bucket) / 60)::integer,
    'checks', (select count(*) from samples),
    'p50_ms', (select round((percentile_cont(0.5) within group (order by s.ms))::numeric) from samples s),
    'p95_ms', (select round((percentile_cont(0.95) within group (order by s.ms))::numeric) from samples s),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('at', b.bucket_start, 'p95_ms', round(pb.p95::numeric), 'checks', coalesce(pb.n, 0)) order by b.bucket_start)
      from buckets b left join per_bucket pb on pb.bucket_start = b.bucket_start
    ), '[]'::jsonb),
    'monitors', coalesce((
      select jsonb_agg(jsonb_build_object('monitor_id', m.monitor_id, 'p50_ms', round(m.p50::numeric), 'p95_ms', round(m.p95::numeric), 'checks', m.n))
      from per_monitor m
    ), '[]'::jsonb),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('component_id', c.component_id, 'p95_ms', round(c.p95::numeric), 'checks', c.n))
      from per_component c
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ------------------------------------------------------------------
-- SLO error budgets (rolling windows ending now), same formula as get_project_metrics()
-- ------------------------------------------------------------------
create or replace function public.get_project_slos(p_project_id uuid)
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

  select coalesce(jsonb_agg(x.slo_row order by x.slo_name, x.slo_id), '[]'::jsonb) into v_result
  from (
    select s.name as slo_name, s.id as slo_id, jsonb_build_object(
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
  ) x;

  return v_result;
end;
$$;

-- ------------------------------------------------------------------
-- Function privileges (revoke from PUBLIC first; the functions check membership themselves)
-- ------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.get_project_uptime(uuid, integer)',
    'public.get_project_latency(uuid, timestamptz, timestamptz, integer)',
    'public.get_project_slos(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
  revoke execute on function public.slos_guard() from public, anon, authenticated;
  revoke execute on function public.projects_guard_insert() from public, anon, authenticated;
end $$;
