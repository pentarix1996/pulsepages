-- Monitors: legacy migration, confirmation results, component automation, draft incidents, heartbeats, plan limits
begin;

do $$
declare
  v_monitor public.monitors;
begin
  select * into v_monitor from public.monitors where legacy_config_id = '00000000-0000-0000-0000-00000000f001';
  assert v_monitor.id is not null, 'legacy config migrated';
  assert v_monitor.type = 'http' and v_monitor.config->>'url' = 'https://api.example.com/health';
  assert jsonb_array_length(v_monitor.config->'assertions') = 2, 'json rules converted to assertions';
  assert (v_monitor.config->'assertions'->1->>'operator') = 'not_equals', 'unhealthy rule negated';
  assert exists (select 1 from public.monitor_components where monitor_id = v_monitor.id and component_id = tests.gateway());
  assert (select count(*) from public.monitor_check_results where monitor_id = v_monitor.id) = 1, 'results re-linked';
  assert not (select enabled from public.component_monitor_configs where id = '00000000-0000-0000-0000-00000000f001'), 'legacy config disabled';
end $$;

-- The runner claims due monitors once (skip locked), records a confirmed failure and recovery
select tests.as_service();
do $$
declare
  v_monitor uuid := (select id from public.monitors where legacy_config_id = '00000000-0000-0000-0000-00000000f001');
  v_claimed integer;
  v_draft public.incidents;
begin
  update public.monitors set next_check_at = now() - interval '1 second' where id = v_monitor;
  select count(*) into v_claimed from public.claim_due_monitors(10) x where (x->>'id')::uuid = v_monitor;
  assert v_claimed = 1, 'claimed';
  select count(*) into v_claimed from public.claim_due_monitors(10) x where (x->>'id')::uuid = v_monitor;
  assert v_claimed = 0, 'not claimed twice';

  perform public.record_monitor_run(
    v_monitor,
    '[{"region": "eu-central-1", "status": "down", "http_status": 503, "latency_ms": 1200, "error": "Status 503"}]'::jsonb,
    '[{"region": "eu-central-1", "consecutive_bad": 2, "consecutive_up": 0, "confirmed": "down", "last_status": "down"}]'::jsonb,
    'down', '{"regions": {"eu-central-1": "down"}}'::jsonb, 'Status 503 is not 200-299'
  );
  assert (select state from public.monitors where id = v_monitor) = 'down';
  assert (select automated_status from public.components where id = tests.gateway()) = 'major_outage';
  assert (select status from public.components where id = tests.gateway()) = 'major_outage';
  assert (select reason from public.component_status_history where component_id = tests.gateway() order by changed_at desc limit 1) = 'monitor';
  assert exists (select 1 from public.alert_events where type = 'monitor_down' and monitor_id = v_monitor), 'monitor_down event';
  assert exists (select 1 from public.alert_events where type = 'component_status_worsened' and component_id = tests.gateway()), 'component event';
  -- legacy monitors keep auto drafts off; a new monitor with auto draft creates one
  assert not exists (select 1 from public.incidents where source_monitor_id = v_monitor);

  perform public.record_monitor_run(
    v_monitor,
    '[{"region": "eu-central-1", "status": "up", "http_status": 200, "latency_ms": 90}]'::jsonb,
    '[{"region": "eu-central-1", "consecutive_bad": 0, "consecutive_up": 2, "confirmed": "up", "last_status": "up"}]'::jsonb,
    'up', '{}'::jsonb
  );
  assert (select status from public.components where id = tests.gateway()) = 'operational';
  assert (select reason from public.component_status_history where component_id = tests.gateway() order by changed_at desc limit 1) = 'monitor_recovery';
  assert exists (select 1 from public.alert_events where type = 'monitor_recovered' and monitor_id = v_monitor);
end $$;

-- A monitor with auto drafts opens a draft incident linked to its components
select tests.as_user(tests.alice());
do $$
declare
  v_monitor public.monitors;
begin
  insert into public.monitors (project_id, name, type, interval_seconds, regions, config)
  values (tests.payments(), 'Webhooks heartbeat', 'heartbeat', 300, array['eu-central-1'], '{"grace_seconds": 60}')
  returning * into v_monitor;
  assert v_monitor.heartbeat_token is not null and length(v_monitor.heartbeat_token) = 36, 'heartbeat token generated';
  insert into public.monitor_components (monitor_id, component_id) values (v_monitor.id, tests.webhooks());
  -- Clients cannot fake results
  begin
    update public.monitors set last_result = '{}'::jsonb where id = v_monitor.id;
    raise exception 'client changed managed field';
  exception when insufficient_privilege then null;
  end;
end $$;

select tests.as_postgres();
do $$
declare
  v_monitor public.monitors := (select m from public.monitors m where m.name = 'Webhooks heartbeat');
  v_result jsonb;
begin
  update public.monitors set created_at = now() - interval '1 hour' where id = v_monitor.id;
  perform public.process_heartbeats();
  assert (select state from public.monitors where id = v_monitor.id) = 'down', 'missed heartbeat';
  assert (select status from public.components where id = tests.webhooks()) = 'major_outage';
  assert exists (select 1 from public.incidents where source_monitor_id = v_monitor.id and status = 'draft'), 'draft incident opened';
  assert (select status from public.components where id = tests.webhooks()) = 'major_outage', 'draft does not change status (monitor does)';

  v_result := public.record_heartbeat(v_monitor.heartbeat_token, true, null);
  assert v_result->>'state' = 'up';
  assert (select status from public.components where id = tests.webhooks()) = 'operational';
  assert public.record_heartbeat('nope', true, null) is null, 'unknown token';
end $$;

-- Plan limits: bob (free) gets 5 monitors at 180 s minimum and one region
select tests.as_user(tests.bob());
do $$
declare
  i integer;
begin
  begin
    insert into public.monitors (project_id, name, type, interval_seconds, config) values (tests.blog(), 'Fast', 'http', 60, '{"url": "https://blog.example.com"}');
    raise exception 'interval limit not enforced';
  exception when raise_exception then
    if sqlerrm not like '%checks every 180 seconds%' then raise; end if;
  end;
  begin
    insert into public.monitors (project_id, name, type, regions, config) values (tests.blog(), 'Multi', 'http', array['eu-central-1', 'us-east-1'], '{"url": "https://blog.example.com"}');
    raise exception 'region limit not enforced';
  exception when raise_exception then
    if sqlerrm not like '%1 region per monitor%' then raise; end if;
  end;
  begin
    insert into public.monitors (project_id, name, type, config) values (tests.blog(), 'Plain', 'http', '{"url": "http://blog.example.com"}');
    raise exception 'http url accepted';
  exception when invalid_parameter_value then null;
  end;
  for i in 1..5 loop
    insert into public.monitors (project_id, name, type, config) values (tests.blog(), 'M' || i, 'http', '{"url": "https://blog.example.com"}');
  end loop;
  begin
    insert into public.monitors (project_id, name, type, config) values (tests.blog(), 'M6', 'http', '{"url": "https://blog.example.com"}');
    raise exception 'monitor limit not enforced';
  exception when raise_exception then
    if sqlerrm not like '%includes 5 active monitors%' then raise; end if;
  end;
end $$;

-- Downgrades pause what does not fit; upgrades resume it
select tests.as_postgres();
do $$
declare
  v_org uuid := (select organization_id from public.projects where id = tests.payments());
begin
  insert into public.monitors (project_id, name, type, interval_seconds, regions, config)
  select tests.payments(), 'Bulk ' || g, 'http', 60, array['eu-central-1', 'us-east-1'], '{"url": "https://x.example.com"}'::jsonb
  from generate_series(1, 6) g;
  update public.organizations set plan = 'free' where id = v_org;
  assert (select count(*) from public.monitors m where m.project_id = tests.payments() and m.enabled and m.paused_reason is null) = 5, 'paused down to 5';
  assert not exists (select 1 from public.monitors where project_id = tests.payments() and type <> 'heartbeat' and interval_seconds < 180), 'intervals clamped';
  assert not exists (select 1 from public.monitors where project_id = tests.payments() and cardinality(regions) > 1), 'regions trimmed';
  update public.organizations set plan = 'business' where id = v_org;
  assert not exists (select 1 from public.monitors where project_id = tests.payments() and paused_reason = 'plan_limit'), 'resumed';
end $$;

-- External signals feed component automation
select tests.as_postgres();
do $$
declare
  v_integration public.inbound_integrations;
begin
  insert into public.inbound_integrations (project_id, type, name) values (tests.payments(), 'alertmanager', 'Prometheus') returning * into v_integration;
  perform public.ingest_signals(v_integration.id, jsonb_build_array(jsonb_build_object('external_id', 'fp1', 'component_id', tests.payments_api(), 'status', 'partial_outage', 'summary', 'High error rate')));
  assert (select automated_source from public.components where id = tests.payments_api()) = 'signal';
  perform public.ingest_signals(v_integration.id, jsonb_build_array(jsonb_build_object('external_id', 'fp1', 'component_id', tests.payments_api(), 'active', false)));
  assert not exists (select 1 from public.component_signals where integration_id = v_integration.id and active);
end $$;

rollback;
