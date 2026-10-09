-- Overview and report aggregates (uptime bars, latency percentiles, SLO budgets) and project/SLO guards
begin;

select tests.as_postgres();

-- Fixture: one monitor linked to Payments API with 20 known latencies in the last hour, plus noise that must be ignored
do $$
declare
  v_monitor uuid;
  i integer;
begin
  insert into public.monitors (project_id, name, type, interval_seconds, config, regions)
  values (tests.payments(), 'Latency fixture', 'http', 60, '{"url": "https://api.example.com/latency"}', array['eu-central-1'])
  returning id into v_monitor;
  insert into public.monitor_components (monitor_id, component_id) values (v_monitor, tests.payments_api());
  for i in 1..20 loop
    insert into public.monitor_check_results (monitor_id, project_id, region, status, response_time_ms, checked_at)
    values (v_monitor, tests.payments(), 'eu-central-1', 'up', i * 10, now() - make_interval(mins => i));
  end loop;
  -- Probe infrastructure errors, rows without latency and rows outside the window do not count
  insert into public.monitor_check_results (monitor_id, project_id, region, status, response_time_ms, checked_at) values
    (v_monitor, tests.payments(), 'eu-central-1', 'error', 99999, now() - interval '5 minutes'),
    (v_monitor, tests.payments(), 'eu-central-1', 'down', null, now() - interval '6 minutes'),
    (v_monitor, tests.payments(), 'eu-central-1', 'up', 88888, now() - interval '3 days');
end $$;

create temporary table t_fixture as select id as monitor_id from public.monitors where name = 'Latency fixture';
grant select on t_fixture to authenticated, service_role;

-- Members (alice owns Payments) read the aggregates through the RLS-bound client
select tests.as_user(tests.alice());
do $$
declare
  v_latency jsonb;
  v_uptime jsonb;
  v_slos jsonb;
  v_component jsonb;
  v_fixture uuid := (select monitor_id from t_fixture);
begin
  v_latency := public.get_project_latency(tests.payments(), now() - interval '24 hours', now(), 60);
  assert (v_latency->>'checks')::integer >= 20, format('checks: %s', v_latency->>'checks');
  assert jsonb_array_length(v_latency->'buckets') = 24, 'one bucket per hour';
  assert (select (m->>'p95_ms')::numeric from jsonb_array_elements(v_latency->'monitors') m where (m->>'monitor_id')::uuid = v_fixture) = 191,
    'p95 of 10..200 ms is 190.5 → 191 (errors and old rows ignored)';
  assert (select (m->>'checks')::integer from jsonb_array_elements(v_latency->'monitors') m where (m->>'monitor_id')::uuid = v_fixture) = 20;
  assert exists (select 1 from jsonb_array_elements(v_latency->'components') c where (c->>'component_id')::uuid = tests.payments_api()),
    'latency per linked component';
  -- Empty buckets are present with zero checks so charts keep their time axis
  assert exists (select 1 from jsonb_array_elements(v_latency->'buckets') b where (b->>'checks')::integer = 0 and b->'p95_ms' = 'null'::jsonb);

  v_uptime := public.get_project_uptime(tests.payments(), 30);
  assert (v_uptime->>'days')::integer = 30;
  assert jsonb_array_length(v_uptime->'components') = 3, format('components: %s', jsonb_array_length(v_uptime->'components'));
  select c into v_component from jsonb_array_elements(v_uptime->'components') c where (c->>'component_id')::uuid = tests.payments_api();
  assert jsonb_array_length(v_component->'days') = 30;
  assert (v_component->>'uptime')::numeric <= 100;
  assert v_component->'days'->-1->>'date' = (now() at time zone (v_uptime->>'timezone'))::date::text, 'last bar is today in the project timezone';
  -- Days are clamped to 1..365
  assert (public.get_project_uptime(tests.payments(), 5000)->>'days')::integer = 365;
  assert (public.get_project_uptime(tests.payments(), 0)->>'days')::integer = 1;

  v_slos := public.get_project_slos(tests.payments());
  assert jsonb_array_length(v_slos) >= 1, 'default SLO';
  assert (v_slos->0->>'budget_remaining')::numeric between 0 and 1;
  assert (v_slos->0->>'allowed_downtime_seconds')::numeric > 0;

  -- Ranges are validated
  begin
    perform public.get_project_latency(tests.payments(), now() - interval '8 days', now(), 60);
    raise exception 'latency range over 7 days accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.get_project_latency(tests.payments(), now(), now() - interval '1 hour', 60);
    raise exception 'reversed range accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.get_project_latency(tests.payments(), now() - interval '7 days', now(), 1);
    raise exception 'too many buckets accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Strangers cannot read another organization's aggregates
select tests.as_user(tests.mallory());
do $$
begin
  begin
    perform public.get_project_uptime(tests.payments(), 90);
    raise exception 'stranger read uptime';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_project_latency(tests.payments());
    raise exception 'stranger read latency';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_project_slos(tests.payments());
    raise exception 'stranger read slos';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anonymous visitors cannot call them at all
select tests.as_anon();
do $$
begin
  begin
    perform public.get_project_uptime(tests.payments(), 90);
    raise exception 'anon read uptime';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The public API (service role acting for a key) is trusted: the server already checked the key
select tests.as_api_key('api_key:alice-key');
do $$
begin
  assert jsonb_array_length(public.get_project_uptime(tests.payments(), 7)->'components') = 3;
  assert (public.get_project_latency(tests.payments())->>'checks')::integer >= 20;
end $$;

-- SLO guard: components must belong to the same status page; SLOs do not move
select tests.as_user(tests.alice());
do $$
declare
  v_slo uuid;
  v_blog_component uuid;
begin
  insert into public.slos (project_id, component_id, name, target, window_days)
  values (tests.payments(), tests.payments_api(), '  Payments API  ', 99.95, 30)
  returning id into v_slo;
  assert (select name from public.slos where id = v_slo) = 'Payments API', 'name trimmed';
  begin
    insert into public.slos (project_id, component_id, name, target, window_days)
    values (tests.payments(), '00000000-0000-0000-0000-0000000c0004', 'Foreign', 99.9, 30);
    raise exception 'foreign component accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.slos set target = 100 where id = v_slo;
    raise exception 'target of 100 accepted';
  exception when check_violation then null;
  end;
end $$;

select tests.as_postgres();
do $$
begin
  begin
    update public.slos set project_id = tests.blog() where project_id = tests.payments() and component_id is not null;
    raise exception 'slo moved to another project';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Project insert guards: plan gates apply on create too. Bob is on Free (one page): remove his Blog page first.
select tests.as_postgres();
delete from public.projects where id = tests.blog();

select tests.as_user(tests.bob());
do $$
declare
  v_org uuid := (select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id where m.user_id = tests.bob() and o.personal);
  v_project public.projects;
begin
  begin
    insert into public.projects (organization_id, name, slug, visibility) values (v_org, 'Secret', 'secret', 'private');
    raise exception 'private page created on free';
  exception when raise_exception then
    if sqlerrm not like '%Business plan%' then raise; end if;
  end;
  begin
    insert into public.projects (organization_id, name, slug, brand_color) values (v_org, 'Branded', 'branded', '#112233');
    raise exception 'branding on free';
  exception when raise_exception then
    if sqlerrm not like '%Branding requires the Pro plan%' then raise; end if;
  end;
  begin
    insert into public.projects (organization_id, name, slug, custom_domain) values (v_org, 'Domain', 'domain', 'status.bob.example');
    raise exception 'custom domain on free';
  exception when raise_exception then
    if sqlerrm not like '%Custom domains require the Pro plan%' then raise; end if;
  end;
  -- A plain page is fine, and verification fields cannot be forged. (No RETURNING: the SELECT policy cannot see a
  -- project inside the statement that creates it, so clients insert first and read afterwards.)
  insert into public.projects (organization_id, name, slug, custom_domain_status, custom_domain_verified_at)
  values (v_org, 'Plain', 'plain', 'verified', now());
  select * into v_project from public.projects where organization_id = v_org and slug = 'plain';
  assert v_project.custom_domain_status = 'none', 'forged verification reset';
  assert v_project.custom_domain_verified_at is null;
end $$;

-- Alice (Pro) can add a custom domain on create; it starts pending. The same slug works in a second organization.
select tests.as_user(tests.alice());
do $$
declare
  v_project public.projects;
  v_team public.organizations;
begin
  insert into public.projects (organization_id, name, slug, custom_domain, custom_domain_status)
  select organization_id, 'Docs', 'docs', 'Status.Alice.Example', 'verified' from public.projects where id = tests.payments();
  select * into v_project from public.projects where slug = 'docs';
  assert v_project.custom_domain = 'status.alice.example', 'domain lowercased';
  assert v_project.custom_domain_status = 'pending', 'domain starts pending';

  v_team := public.create_organization('Alice Team', 'alice-team');
  insert into public.projects (organization_id, name, slug) values (v_team.id, 'Payments', 'payments');
  assert (select count(*) from public.projects where slug = 'payments') = 2, 'slug reused in another organization by the same creator';
end $$;

-- API keys go through the same insert guard (room made again so the page limit is not what fails)
select tests.as_postgres();
delete from public.projects where slug = 'plain';

select tests.as_api_key('api_key:bob-key');
do $$
declare
  v_org uuid := (select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id where m.user_id = tests.bob() and o.personal);
begin
  begin
    insert into public.projects (organization_id, name, slug, hide_powered_by) values (v_org, 'Hidden', 'hidden', true);
    raise exception 'api key hid powered-by on free';
  exception when raise_exception then
    if sqlerrm not like '%Branding requires the Pro plan%' then raise; end if;
  end;
end $$;

rollback;
