-- ==========================================
-- Migration: v2 monitor extras (aggregates for the monitors pages)
-- ==========================================
-- The panel needs statistics over thousands of checks (a 30 s monitor in 3 regions writes 8,640 rows a day) without
-- downloading them: 24-hour availability and a latency sparkline per monitor (list page), and latency percentiles per
-- region and time bucket (detail chart and region tiles). Both functions run as the caller (security invoker), so RLS
-- on monitor_check_results limits dashboard users to their own projects; the API checks access before calling them.
-- Probe errors ('error': the probe itself failed) never count as checks. Legacy statuses map to up/down.

create or replace function public.monitor_summaries(p_project_id uuid, p_hours integer default 24, p_buckets integer default 24)
returns table (
  monitor_id uuid,
  checks integer,
  failing integer,
  degraded integer,
  availability numeric,
  avg_latency_ms integer,
  p95_latency_ms integer,
  latency_buckets integer[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 90))) as since,
           now() as until,
           greatest(1, least(coalesce(p_buckets, 24), 200)) as buckets
  ),
  results as (
    select r.monitor_id,
           case r.status when 'success' then 'up' when 'failure' then 'down' else r.status end as status,
           r.response_time_ms,
           least(
             p.buckets - 1,
             floor(extract(epoch from (r.checked_at - p.since)) / greatest(1, extract(epoch from (p.until - p.since)) / p.buckets))::integer
           ) as bucket
    from public.monitor_check_results r
    cross join params p
    where r.project_id = p_project_id
      and r.monitor_id is not null
      and r.checked_at >= p.since
      and r.checked_at <= p.until
  ),
  per_bucket as (
    select x.monitor_id, x.bucket, round(avg(x.response_time_ms) filter (where x.status in ('up', 'degraded')))::integer as latency
    from results x
    group by x.monitor_id, x.bucket
  ),
  totals as (
    select x.monitor_id,
           (count(*) filter (where x.status <> 'error'))::integer as checks,
           (count(*) filter (where x.status = 'down'))::integer as failing,
           (count(*) filter (where x.status = 'degraded'))::integer as degraded,
           round(avg(x.response_time_ms) filter (where x.status in ('up', 'degraded')))::integer as avg_latency_ms,
           (percentile_cont(0.95) within group (order by x.response_time_ms)
              filter (where x.status in ('up', 'degraded') and x.response_time_ms is not null))::integer as p95_latency_ms
    from results x
    group by x.monitor_id
  )
  select t.monitor_id,
         t.checks,
         t.failing,
         t.degraded,
         case when t.checks > 0 then round(100.0 * (t.checks - t.failing) / t.checks, 3) end,
         t.avg_latency_ms,
         t.p95_latency_ms,
         (
           select array_agg(b.latency order by g.i)
           from generate_series(0, (select p.buckets from params p) - 1) g(i)
           left join per_bucket b on b.monitor_id = t.monitor_id and b.bucket = g.i
         )
  from totals t
$$;

create or replace function public.monitor_latency_series(p_monitor_id uuid, p_from timestamptz default null, p_to timestamptz default null, p_buckets integer default 96)
returns table (
  region text,
  bucket integer,
  bucket_start timestamptz,
  checks integer,
  failing integer,
  degraded integer,
  errors integer,
  avg_latency_ms integer,
  p50_latency_ms integer,
  p95_latency_ms integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with raw as (
    select coalesce(p_to, now()) as until,
           coalesce(p_from, coalesce(p_to, now()) - interval '24 hours') as since,
           greatest(1, least(coalesce(p_buckets, 96), 500)) as buckets
  ),
  params as (
    select greatest(least(r.since, r.until), r.until - interval '90 days') as since, r.until, r.buckets from raw r
  ),
  results as (
    select coalesce(x.region, 'unknown') as region,
           case x.status when 'success' then 'up' when 'failure' then 'down' else x.status end as status,
           x.response_time_ms,
           least(
             p.buckets - 1,
             floor(extract(epoch from (x.checked_at - p.since)) / greatest(1, extract(epoch from (p.until - p.since)) / p.buckets))::integer
           ) as bucket
    from public.monitor_check_results x
    cross join params p
    where x.monitor_id = p_monitor_id
      and x.checked_at >= p.since
      and x.checked_at <= p.until
  )
  select r.region,
         r.bucket,
         (select p.since + make_interval(secs => (r.bucket * extract(epoch from (p.until - p.since)) / p.buckets)::double precision) from params p),
         (count(*) filter (where r.status <> 'error'))::integer,
         (count(*) filter (where r.status = 'down'))::integer,
         (count(*) filter (where r.status = 'degraded'))::integer,
         (count(*) filter (where r.status = 'error'))::integer,
         round(avg(r.response_time_ms) filter (where r.status in ('up', 'degraded')))::integer,
         (percentile_cont(0.5) within group (order by r.response_time_ms)
            filter (where r.status in ('up', 'degraded') and r.response_time_ms is not null))::integer,
         (percentile_cont(0.95) within group (order by r.response_time_ms)
            filter (where r.status in ('up', 'degraded') and r.response_time_ms is not null))::integer
  from results r
  group by r.region, r.bucket
  order by r.region, r.bucket
$$;

revoke execute on function public.monitor_summaries(uuid, integer, integer) from public, anon;
grant execute on function public.monitor_summaries(uuid, integer, integer) to authenticated, service_role;
revoke execute on function public.monitor_latency_series(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.monitor_latency_series(uuid, timestamptz, timestamptz, integer) to authenticated, service_role;
