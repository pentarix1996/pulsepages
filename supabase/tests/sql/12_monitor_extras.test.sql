-- Monitor extras: per-monitor summaries and per-region latency series for the panel (security invoker + RLS)
begin;

select tests.as_postgres();
do $$
declare
  v_monitor uuid;
begin
  insert into public.monitors (project_id, name, type, regions, config)
  values (tests.payments(), 'Stats probe', 'http', array['eu-central-1', 'us-east-1'], '{"url": "https://stats.example.com/health"}')
  returning id into v_monitor;

  -- 100 rounds every 10 minutes in two regions: every 10th check is down, every 10th (offset 5) degraded.
  insert into public.monitor_check_results (monitor_id, project_id, region, status, http_status, response_time_ms, checked_at)
  select v_monitor, tests.payments(), r,
         case when g % 10 = 0 then 'down' when g % 10 = 5 then 'degraded' else 'up' end,
         case when g % 10 = 0 then 503 else 200 end,
         case when r = 'eu-central-1' then 100 else 300 end + g,
         now() - make_interval(mins => g * 10)
  from generate_series(1, 100) g, unnest(array['eu-central-1', 'us-east-1']) r;

  -- Probe errors and checks older than the window never count
  insert into public.monitor_check_results (monitor_id, project_id, region, status, checked_at)
  values (v_monitor, tests.payments(), 'eu-central-1', 'error', now() - interval '5 minutes');
  insert into public.monitor_check_results (monitor_id, project_id, region, status, response_time_ms, checked_at)
  values (v_monitor, tests.payments(), 'eu-central-1', 'down', 999, now() - interval '30 hours');

  perform set_config('tests.stats_monitor', v_monitor::text, false);
end $$;

-- Members see the summary of their monitors
select tests.as_user(tests.alice());
do $$
declare
  v_monitor uuid := current_setting('tests.stats_monitor')::uuid;
  v_row record;
begin
  select * into v_row from public.monitor_summaries(tests.payments()) s where s.monitor_id = v_monitor;
  assert v_row.monitor_id is not null, 'summary returned for a member';
  assert v_row.checks = 200, format('checks: %s', v_row.checks);
  assert v_row.failing = 20, format('failing: %s', v_row.failing);
  assert v_row.degraded = 20, format('degraded: %s', v_row.degraded);
  assert v_row.availability = 90.000, format('availability: %s', v_row.availability);
  assert cardinality(v_row.latency_buckets) = 24, 'one latency value per bucket';
  assert v_row.latency_buckets[24] is not null, 'latest bucket has data';
  assert v_row.p95_latency_ms >= v_row.avg_latency_ms, 'p95 above average';

  select * into v_row from public.monitor_summaries(tests.payments(), 6, 12) s where s.monitor_id = v_monitor;
  assert v_row.checks = 72, format('6-hour window checks: %s', v_row.checks);
  assert cardinality(v_row.latency_buckets) = 12;
end $$;

do $$
declare
  v_monitor uuid := current_setting('tests.stats_monitor')::uuid;
  v_total integer;
  v_errors integer;
  v_regions integer;
  v_bad integer;
begin
  select sum(checks), sum(errors), count(distinct region), count(*) filter (where bucket < 0 or bucket > 23 or p95_latency_ms < p50_latency_ms)
  into v_total, v_errors, v_regions, v_bad
  from public.monitor_latency_series(v_monitor, now() - interval '24 hours', now(), 24);
  assert v_total = 200, format('series checks: %s', v_total);
  assert v_errors = 1, 'probe error counted separately';
  assert v_regions = 2, 'one series per region';
  assert v_bad = 0, 'buckets in range and p95 >= p50';
  assert (select max(avg_latency_ms) from public.monitor_latency_series(v_monitor, now() - interval '24 hours', now(), 24) where region = 'eu-central-1')
       < (select min(avg_latency_ms) from public.monitor_latency_series(v_monitor, now() - interval '24 hours', now(), 24) where region = 'us-east-1'),
       'regions keep their own latency';
  -- Defaults and clamps: no window (24 hours) and a bucket count of zero (one bucket)
  assert (select count(*) from public.monitor_latency_series(v_monitor, null, null, 0)) = 2, 'one bucket per region';
end $$;

-- Strangers see nothing (RLS on monitor_check_results applies inside the invoker functions)
select tests.as_user(tests.mallory());
do $$
begin
  assert (select count(*) from public.monitor_summaries(tests.payments())) = 0, 'no summaries for strangers';
  assert (select count(*) from public.monitor_latency_series(current_setting('tests.stats_monitor')::uuid)) = 0, 'no series for strangers';
end $$;

-- Anonymous callers cannot execute them
select tests.as_anon();
do $$
begin
  begin
    perform public.monitor_summaries(tests.payments());
    raise exception 'anon executed monitor_summaries';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
