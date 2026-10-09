-- Uptime (A-3), daily status and project metrics
begin;

select tests.as_postgres();

do $$
declare
  v_component uuid;
  v_uptime numeric;
  v_days integer;
  v_worst text;
begin
  -- A component that existed for 30 days, operational, with a single 10 minute major outage ending 1 hour ago
  insert into public.components (project_id, name, created_at) values (tests.payments(), 'Search', now() - interval '30 days') returning id into v_component;
  delete from public.component_status_history where component_id = v_component;
  insert into public.component_status_history (component_id, status, changed_at, reason) values
    (v_component, 'major_outage', now() - interval '70 minutes', 'monitor'),
    (v_component, 'operational', now() - interval '60 minutes', 'monitor_recovery');

  v_uptime := public.component_uptime(v_component, now() - interval '30 days');
  assert v_uptime between 99.97 and 99.98, format('uptime should be ~99.977, got %s', v_uptime);

  -- A brand-new outage on a component without history no longer reads as 0 %
  insert into public.component_status_history (component_id, status, changed_at, reason) values
    (v_component, 'major_outage', now() - interval '10 minutes', 'monitor');
  v_uptime := public.component_uptime(v_component, now() - interval '30 days');
  assert v_uptime > 99.9, format('got %s', v_uptime);

  -- Partial outages weigh 30 %, degraded counts as up by default
  insert into public.components (project_id, name, created_at) values (tests.payments(), 'CDN', now() - interval '10 days') returning id into v_component;
  delete from public.component_status_history where component_id = v_component;
  insert into public.component_status_history (component_id, status, changed_at, reason) values
    (v_component, 'partial_outage', now() - interval '5 days', 'manual'),
    (v_component, 'degraded', now() - interval '4 days', 'manual'),
    (v_component, 'operational', now() - interval '3 days', 'manual');
  v_uptime := public.component_uptime(v_component, now() - interval '10 days');
  assert v_uptime between 96.9 and 97.1, format('expected ~97 (1 day of partial at 30%% over 10 days), got %s', v_uptime);

  -- Daily status: 90 rows, days before creation have no data, the partial day is marked
  select count(*), count(*) filter (where worst_status is null) into v_days, v_worst
  from public.component_daily_status(array[v_component], 90, 'Europe/Madrid');
  assert v_days = 90;
  select worst_status into v_worst from public.component_daily_status(array[v_component], 90, 'UTC')
  where day = (now() at time zone 'UTC')::date - 5;
  assert v_worst = 'partial_outage', format('got %s', v_worst);
end $$;

-- MTTA / MTTR
do $$
declare
  v_metrics jsonb;
  v_incident uuid;
begin
  insert into public.incidents (project_id, title, status, impact, detected_at, acknowledged_at, resolved_at)
  values (tests.payments(), 'Measured', 'resolved', 'major', now() - interval '2 hours', now() - interval '110 minutes', now() - interval '1 hour')
  returning id into v_incident;
  v_metrics := public.get_project_metrics(tests.payments(), now() - interval '1 day', now());
  assert (v_metrics->'incidents'->>'total')::integer >= 1;
  assert (v_metrics->'incidents'->>'mtta_seconds')::numeric > 0;
  assert (v_metrics->'incidents'->>'mttr_seconds')::numeric > 0;
  assert jsonb_array_length(v_metrics->'slos') = 1, 'default SLO';
  assert (v_metrics->'slos'->0->>'target')::numeric = 99.9;
end $$;

select tests.as_user(tests.mallory());
do $$
begin
  begin
    perform public.get_project_metrics(tests.payments(), now() - interval '1 day', now());
    raise exception 'stranger read metrics';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
