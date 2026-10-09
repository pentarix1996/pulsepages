-- Local development seed (applied by `supabase db reset`, or by hand with psql). Never runs in production.
-- Users: owner@upvane.test (owner) and oncall@upvane.test (responder), password "upvane-demo-1".
-- Organization "Quillbase" (Business) with the "Quillbase status" page, plus each user's personal workspace.
-- API key for local testing: upv_live_demo0000000000000000000000000000000000 (write scope).

set check_function_bodies = off;
select set_config('upvane.suppress_events', 'on', false);

do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_oncall uuid := '22222222-2222-4222-8222-222222222222';
  v_user record;
begin
  for v_user in
    select * from (values
      (v_owner, 'owner@upvane.test', 'Marta Ruiz'),
      (v_oncall, 'oncall@upvane.test', 'Leo Park')
    ) as u(id, email, name)
  loop
    if not exists (select 1 from auth.users where id = v_user.id) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated', v_user.email,
        extensions.crypt('upvane-demo-1', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('name', v_user.name), now() - interval '120 days', now(),
        '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_user.id, v_user.id::text, jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true), 'email', now(), now(), now());
    end if;
  end loop;
end $$;

do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_oncall uuid := '22222222-2222-4222-8222-222222222222';
  v_org uuid := '33333333-3333-4333-8333-333333333333';
  v_project uuid := '44444444-4444-4444-8444-444444444444';
  g_core uuid := '55555555-0000-4000-8000-000000000001';
  g_edge uuid := '55555555-0000-4000-8000-000000000002';
  c_api uuid := '66666666-0000-4000-8000-000000000001';
  c_dash uuid := '66666666-0000-4000-8000-000000000002';
  c_webhooks uuid := '66666666-0000-4000-8000-000000000003';
  c_db uuid := '66666666-0000-4000-8000-000000000004';
  c_cdn uuid := '66666666-0000-4000-8000-000000000005';
  c_auth uuid := '66666666-0000-4000-8000-000000000006';
  m_api uuid := '77777777-0000-4000-8000-000000000001';
  m_dash uuid := '77777777-0000-4000-8000-000000000002';
  m_webhooks uuid := '77777777-0000-4000-8000-000000000003';
  m_db uuid := '77777777-0000-4000-8000-000000000004';
  m_tls uuid := '77777777-0000-4000-8000-000000000005';
  m_cron uuid := '77777777-0000-4000-8000-000000000006';
  i_active uuid := '88888888-0000-4000-8000-000000000001';
  i_past uuid := '88888888-0000-4000-8000-000000000002';
  i_old uuid := '88888888-0000-4000-8000-000000000003';
  v_channel uuid;
  v_region text;
  v_t timestamptz;
  v_day integer;
begin
  if exists (select 1 from public.organizations where id = v_org) then
    return;
  end if;

  insert into public.organizations (id, name, slug, plan, personal, created_by, created_at)
  values (v_org, 'Quillbase', 'quillbase', 'business', false, v_owner, now() - interval '120 days');
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_owner, 'owner'), (v_org, v_oncall, 'responder');

  insert into public.projects (id, organization_id, user_id, name, slug, description, timezone, brand_color, support_url, created_at)
  values (v_project, v_org, v_owner, 'Quillbase status', 'status', 'Payments, dashboard and webhooks for Quillbase customers.', 'Europe/Madrid', '#0E7490', 'https://quillbase.example/support', now() - interval '120 days');

  insert into public.component_groups (id, project_id, name, position) values (g_core, v_project, 'Core platform', 0), (g_edge, v_project, 'Edge and delivery', 1);
  insert into public.components (id, project_id, name, slug, description, group_id, position, created_at) values
    (c_api, v_project, 'Payments API', 'payments-api', 'Card payments, refunds and payouts.', g_core, 0, now() - interval '120 days'),
    (c_dash, v_project, 'Dashboard', 'dashboard', 'The web app at app.quillbase.example.', g_core, 1, now() - interval '120 days'),
    (c_db, v_project, 'Primary database', 'database', null, g_core, 2, now() - interval '120 days'),
    (c_webhooks, v_project, 'Webhooks', 'webhooks', 'Event delivery to your endpoints.', g_edge, 0, now() - interval '120 days'),
    (c_cdn, v_project, 'CDN', 'cdn', null, g_edge, 1, now() - interval '120 days'),
    (c_auth, v_project, 'Sign in', 'auth', null, g_core, 3, now() - interval '60 days');
  insert into public.component_dependencies (component_id, depends_on_id, impact) values (c_api, c_db, 'partial_outage'), (c_dash, c_api, 'degraded');

  -- 90 days of history: a few short incidents
  delete from public.component_status_history where component_id in (c_api, c_dash, c_db, c_webhooks, c_cdn, c_auth);
  insert into public.component_status_history (component_id, status, changed_at, reason) values
    (c_api, 'operational', now() - interval '120 days', 'system'),
    (c_dash, 'operational', now() - interval '120 days', 'system'),
    (c_db, 'operational', now() - interval '120 days', 'system'),
    (c_webhooks, 'operational', now() - interval '120 days', 'system'),
    (c_cdn, 'operational', now() - interval '120 days', 'system'),
    (c_auth, 'operational', now() - interval '60 days', 'system'),
    (c_api, 'major_outage', now() - interval '41 days 3 hours', 'incident'),
    (c_api, 'operational', now() - interval '41 days 2 hours 20 minutes', 'incident_resolved'),
    (c_webhooks, 'degraded', now() - interval '23 days 6 hours', 'monitor'),
    (c_webhooks, 'operational', now() - interval '23 days 5 hours', 'monitor_recovery'),
    (c_cdn, 'partial_outage', now() - interval '12 days 4 hours', 'signal'),
    (c_cdn, 'operational', now() - interval '12 days 3 hours 15 minutes', 'system'),
    (c_db, 'maintenance', now() - interval '8 days 2 hours', 'maintenance'),
    (c_db, 'operational', now() - interval '8 days 1 hour', 'maintenance'),
    (c_dash, 'degraded', now() - interval '3 days 5 hours', 'monitor'),
    (c_dash, 'operational', now() - interval '3 days 4 hours 35 minutes', 'monitor_recovery');

  -- Monitors
  insert into public.monitors (id, project_id, name, type, interval_seconds, regions, confirm_failures, confirm_regions, recovery_successes, config, state, state_changed_at, last_checked_at, auto_draft_incident, created_by, created_at) values
    (m_api, v_project, 'Payments API health', 'http', 30, array['eu-central-1','us-east-1','ap-southeast-1'], 2, 2, 2,
      '{"url":"https://api.quillbase.example/health","method":"GET","expected_status_codes":["200-299"],"follow_redirects":true,"latency_threshold_ms":800,"headers":[{"name":"Accept","value":"application/json"}],"assertions":[{"source":"json","path":"status","operator":"equals","value":"ok","on_fail":"down"},{"source":"json","path":"queue.depth","operator":"less_than","value":1000,"on_fail":"degraded"}]}',
      'up', now() - interval '3 days', now() - interval '20 seconds', true, v_owner, now() - interval '90 days'),
    (m_dash, v_project, 'Dashboard login page', 'keyword', 60, array['eu-central-1','us-east-1'], 2, 1, 2,
      '{"url":"https://app.quillbase.example/login","method":"GET","keyword":"Sign in","keyword_mode":"contains","follow_redirects":true}',
      'up', now() - interval '3 days', now() - interval '40 seconds', true, v_owner, now() - interval '90 days'),
    (m_webhooks, v_project, 'Webhook delivery', 'http', 60, array['eu-central-1','us-east-1','ap-southeast-1'], 2, 2, 2,
      '{"url":"https://hooks.quillbase.example/health","method":"POST","body":"{\"ping\":true}","expected_status_codes":["2xx"],"latency_threshold_ms":1200}',
      'degraded', now() - interval '25 minutes', now() - interval '35 seconds', true, v_owner, now() - interval '80 days'),
    (m_db, v_project, 'Postgres primary', 'tcp', 60, array['eu-central-1'], 2, 1, 2, '{"host":"db.quillbase.example","port":5432}', 'up', now() - interval '8 days', now() - interval '50 seconds', true, v_owner, now() - interval '80 days'),
    (m_tls, v_project, 'api.quillbase.example certificate', 'tls', 3600, array['eu-central-1'], 1, 1, 1, '{"hostname":"api.quillbase.example","port":443,"warn_days":21}', 'up', now() - interval '60 days', now() - interval '20 minutes', false, v_owner, now() - interval '60 days'),
    (m_cron, v_project, 'Nightly invoice job', 'heartbeat', 86400, array['eu-central-1'], 1, 1, 1, '{"grace_seconds":1800}', 'up', now() - interval '20 days', now() - interval '7 hours', true, v_owner, now() - interval '30 days');
  update public.monitors set tls_expires_at = now() + interval '64 days', tls_checked_at = now() - interval '20 minutes' where id = m_tls;
  update public.monitors set heartbeat_token = 'demo-heartbeat-token-nightly-invoices', last_heartbeat_at = now() - interval '7 hours' where id = m_cron;
  update public.monitors set last_error = 'Responded in 1840 ms, slower than 1200 ms.', last_result = '{"regions":{"eu-central-1":"degraded","us-east-1":"degraded","ap-southeast-1":"up"},"latency_ms":1530,"http_status":200,"quorum":2}' where id = m_webhooks;
  insert into public.monitor_components (monitor_id, component_id) values (m_api, c_api), (m_dash, c_dash), (m_webhooks, c_webhooks), (m_db, c_db), (m_tls, c_api), (m_cron, c_api);

  insert into public.monitor_region_state (monitor_id, region, consecutive_bad, consecutive_up, confirmed, last_status, last_latency_ms, last_checked_at) values
    (m_api, 'eu-central-1', 0, 120, 'up', 'up', 182, now() - interval '20 seconds'),
    (m_api, 'us-east-1', 0, 118, 'up', 'up', 246, now() - interval '20 seconds'),
    (m_api, 'ap-southeast-1', 0, 97, 'up', 'up', 411, now() - interval '20 seconds'),
    (m_dash, 'eu-central-1', 0, 50, 'up', 'up', 302, now() - interval '40 seconds'),
    (m_dash, 'us-east-1', 0, 49, 'up', 'up', 355, now() - interval '40 seconds'),
    (m_webhooks, 'eu-central-1', 4, 0, 'degraded', 'degraded', 1840, now() - interval '35 seconds'),
    (m_webhooks, 'us-east-1', 3, 0, 'degraded', 'degraded', 1620, now() - interval '35 seconds'),
    (m_webhooks, 'ap-southeast-1', 0, 12, 'up', 'up', 1130, now() - interval '35 seconds'),
    (m_db, 'eu-central-1', 0, 300, 'up', 'up', 12, now() - interval '50 seconds');

  -- 24 hours of checks every 5 minutes for the HTTP monitors
  for v_t in select generate_series(now() - interval '24 hours', now() - interval '1 minute', interval '5 minutes') loop
    foreach v_region in array array['eu-central-1','us-east-1','ap-southeast-1'] loop
      insert into public.monitor_check_results (monitor_id, project_id, region, status, resulting_status, http_status, response_time_ms, checked_at)
      values (m_api, v_project, v_region, 'up', 'operational', 200,
        (case v_region when 'eu-central-1' then 170 when 'us-east-1' then 235 else 400 end + (random() * 60)::int), v_t);
      insert into public.monitor_check_results (monitor_id, project_id, region, status, resulting_status, http_status, response_time_ms, error_message, checked_at)
      values (m_webhooks, v_project, v_region,
        case when v_t > now() - interval '30 minutes' and v_region <> 'ap-southeast-1' then 'degraded' else 'up' end,
        case when v_t > now() - interval '30 minutes' and v_region <> 'ap-southeast-1' then 'degraded' else 'operational' end,
        200,
        case when v_t > now() - interval '30 minutes' and v_region <> 'ap-southeast-1' then 1500 + (random() * 400)::int else 420 + (random() * 120)::int end,
        case when v_t > now() - interval '30 minutes' and v_region <> 'ap-southeast-1' then 'Responded in 1840 ms, slower than 1200 ms.' else null end,
        v_t);
    end loop;
  end loop;

  -- Webhooks are degraded right now (from the monitor)
  update public.components set automated_status = 'degraded', automated_source = 'monitor' where id = c_webhooks;

  -- Incidents
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into public.incidents (id, project_id, title, description, status, impact, detected_at, acknowledged_at, acknowledged_by, published_at, resolved_at, created_by, source, created_at)
  values
    (i_past, v_project, 'Failed card payments in EU', 'Card payments failed for EU customers.', 'resolved', 'major', now() - interval '41 days 3 hours', now() - interval '41 days 2 hours 55 minutes', v_owner, now() - interval '41 days 2 hours 54 minutes', now() - interval '41 days 2 hours 20 minutes', v_owner, 'monitor', now() - interval '41 days 3 hours'),
    (i_old, v_project, 'Slow dashboard', 'Dashboard pages loaded slowly.', 'resolved', 'minor', now() - interval '3 days 5 hours', now() - interval '3 days 4 hours 58 minutes', v_oncall, now() - interval '3 days 4 hours 57 minutes', now() - interval '3 days 4 hours 35 minutes', v_oncall, 'manual', now() - interval '3 days 5 hours'),
    (i_active, v_project, 'Delayed webhook deliveries', 'Webhook deliveries are taking longer than usual.', 'identified', 'minor', now() - interval '25 minutes', now() - interval '22 minutes', v_oncall, now() - interval '21 minutes', null, v_oncall, 'monitor', now() - interval '25 minutes');
  insert into public.incident_components (incident_id, component_id, status) values (i_past, c_api, 'operational'), (i_old, c_dash, 'operational'), (i_active, c_webhooks, 'degraded');
  insert into public.incident_updates (incident_id, kind, visibility, status, message, component_statuses, notify_subscribers, created_by, created_at) values
    (i_past, 'update', 'public', 'investigating', 'Card payments are failing for some EU customers. We are investigating.', jsonb_build_object(c_api, 'major_outage'), true, v_owner, now() - interval '41 days 2 hours 54 minutes'),
    (i_past, 'note', 'internal', 'investigating', 'Connection pool exhausted on payments-db-1. Raising max_connections.', '{}', false, v_owner, now() - interval '41 days 2 hours 40 minutes'),
    (i_past, 'update', 'public', 'identified', 'A database connection limit caused timeouts. We raised the limit and are draining stuck connections.', jsonb_build_object(c_api, 'partial_outage'), true, v_owner, now() - interval '41 days 2 hours 35 minutes'),
    (i_past, 'update', 'public', 'resolved', 'Payments are working normally. We will publish a postmortem.', jsonb_build_object(c_api, 'operational'), true, v_owner, now() - interval '41 days 2 hours 20 minutes'),
    (i_old, 'update', 'public', 'investigating', 'Some dashboard pages are slow to load.', jsonb_build_object(c_dash, 'degraded'), true, v_oncall, now() - interval '3 days 4 hours 57 minutes'),
    (i_old, 'update', 'public', 'resolved', 'Page load times are back to normal after a cache fix.', jsonb_build_object(c_dash, 'operational'), true, v_oncall, now() - interval '3 days 4 hours 35 minutes'),
    (i_active, 'update', 'internal', 'draft', 'Upvane confirmed the failure: Responded in 1840 ms, slower than 1200 ms.', jsonb_build_object(c_webhooks, 'degraded'), false, null, now() - interval '25 minutes'),
    (i_active, 'update', 'public', 'investigating', 'Webhook deliveries are delayed by up to 2 minutes. Payments are not affected.', jsonb_build_object(c_webhooks, 'degraded'), true, v_oncall, now() - interval '21 minutes'),
    (i_active, 'note', 'internal', 'investigating', 'Queue depth 48k on hooks-worker. Scaling consumers from 6 to 12.', '{}', false, v_oncall, now() - interval '15 minutes'),
    (i_active, 'update', 'public', 'identified', 'A backlog in our delivery queue is causing the delay. We are adding capacity.', jsonb_build_object(c_webhooks, 'degraded'), true, v_oncall, now() - interval '9 minutes');
  insert into public.postmortems (incident_id, project_id, status, title, summary, impact, root_cause, resolution, lessons, action_items, published_at, created_by, created_at)
  values (i_past, v_project, 'published', 'Postmortem: Failed card payments in EU',
    'For 40 minutes, about 18% of card payments from EU customers failed.',
    'EU customers saw declined payments; retries succeeded after recovery. No data was lost.',
    'A connection pool limit on the primary database was reached after a traffic spike from a batch job.',
    'We raised the connection limit, drained stuck connections and moved the batch job to a replica.',
    'Pool saturation was visible 15 minutes earlier in metrics but did not alert.',
    '[{"id":"a1","title":"Alert on connection pool usage above 80%","owner":"Leo Park","done":true},{"id":"a2","title":"Run batch jobs against the read replica","owner":"Marta Ruiz","done":false,"due_date":"2026-11-01"}]',
    now() - interval '39 days', v_owner, now() - interval '40 days');
  perform set_config('request.jwt.claims', '', true);

  -- Maintenance windows
  insert into public.maintenances (project_id, title, description, status, scheduled_start, scheduled_end, actual_start, actual_end, created_by, created_at)
  values
    (v_project, 'Database version upgrade', 'We will upgrade the primary database. Payments may be slower for up to 10 minutes.', 'scheduled', date_trunc('hour', now()) + interval '2 days 2 hours', date_trunc('hour', now()) + interval '2 days 3 hours', null, null, v_owner, now() - interval '1 day'),
    (v_project, 'Network maintenance', 'Planned work on our network provider.', 'completed', now() - interval '8 days 2 hours', now() - interval '8 days 1 hour', now() - interval '8 days 2 hours', now() - interval '8 days 1 hour', v_owner, now() - interval '10 days');
  insert into public.maintenance_components (maintenance_id, component_id)
  select m.id, c_db from public.maintenances m where m.project_id = v_project;
  insert into public.maintenance_updates (maintenance_id, status, message, created_by, created_at)
  select m.id, 'scheduled', m.description, v_owner, m.created_at from public.maintenances m where m.project_id = v_project;

  -- Alerts: Slack-like webhook channel without secret (shows "secret missing"), team email channel, rules come from defaults
  select id into v_channel from public.alert_channels where project_id = v_project and type = 'email' limit 1;
  if v_channel is not null then
    insert into public.alert_email_recipients (channel_id, email, verified_at) values (v_channel, 'oncall@upvane.test', now()) on conflict do nothing;
  end if;
  update public.alert_rules set enabled = true where project_id = v_project;

  -- Subscribers
  insert into public.status_page_subscribers (project_id, type, email, component_ids, confirmed_at, unsubscribe_token_hash, created_at)
  values
    (v_project, 'email', 'reader@customer.example', '{}', now() - interval '30 days', encode(extensions.digest('seed-unsub-1', 'sha256'), 'hex'), now() - interval '30 days'),
    (v_project, 'email', 'finance@customer.example', array[c_api], now() - interval '10 days', encode(extensions.digest('seed-unsub-2', 'sha256'), 'hex'), now() - interval '10 days'),
    (v_project, 'email', 'pending@customer.example', '{}', null, encode(extensions.digest('seed-unsub-3', 'sha256'), 'hex'), now() - interval '1 day');

  -- Inbound integration
  insert into public.inbound_integrations (project_id, type, name, token, default_component_id, default_status, created_by)
  values (v_project, 'alertmanager', 'Prometheus Alertmanager', 'demo-inbound-token-alertmanager-0000000000', c_api, 'partial_outage', v_owner);

  -- API key: upv_live_demo0000000000000000000000000000000000
  insert into public.api_keys (organization_id, project_id, user_id, name, token_hash, prefix, scopes, created_by)
  values (v_org, null, v_owner, 'Local demo key', encode(extensions.digest('upv_live_demo0000000000000000000000000000000000', 'sha256'), 'hex'), 'upv_live_demo', array['read','write'], v_owner);

  -- Recompute everything once
  for v_day in 0..0 loop
    perform public.recompute_component_status(id, 'system', null) from public.components where project_id = v_project;
  end loop;
end $$;

select set_config('upvane.suppress_events', 'off', false);
