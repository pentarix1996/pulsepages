-- API-key writes (service role + x-upvane-actor header) obey the same guards as dashboard users (spec §8)
begin;

select tests.as_api_key('api_key:bob-key');
do $$
begin
  assert public.request_api_actor() = 'api_key:bob-key';
  assert not public.is_privileged_session(), 'api actor is not privileged';
  -- Plan limits raise instead of silently clamping
  begin
    insert into public.monitors (project_id, name, type, interval_seconds, config) values (tests.blog(), 'Fast', 'http', 60, '{"url": "https://blog.example.com"}');
    raise exception 'interval limit not enforced for API keys';
  exception when raise_exception then
    if sqlerrm not like '%checks every 180 seconds%' then raise; end if;
  end;
  -- Branding needs Pro
  begin
    update public.projects set brand_color = '#112233' where id = tests.blog();
    raise exception 'branding allowed on free';
  exception when raise_exception then
    if sqlerrm not like '%Branding requires the Pro plan%' then raise; end if;
  end;
end $$;

select tests.as_api_key('api_key:alice-key');
do $$
declare
  v_monitor uuid := (select id from public.monitors where legacy_config_id = '00000000-0000-0000-0000-00000000f001');
  v_org uuid := (select organization_id from public.projects where id = tests.payments());
  v_incident public.incidents;
begin
  -- Private pages need Business
  begin
    update public.projects set visibility = 'private' where id = tests.payments();
    raise exception 'private page allowed on pro';
  exception when raise_exception then null;
  end;
  -- Managed fields stay managed
  begin
    update public.monitors set last_result = '{}'::jsonb where id = v_monitor;
    raise exception 'api changed managed monitor fields';
  exception when insufficient_privilege then null;
  end;
  -- Custom domains cannot be self-verified
  update public.projects set custom_domain = 'status.example.org' where id = tests.payments();
  begin
    update public.projects set custom_domain_status = 'verified' where id = tests.payments();
    raise exception 'api verified a domain';
  exception when insufficient_privilege then null;
  end;
  -- Projects can be created by an authorized key (no user membership involved)
  insert into public.projects (organization_id, name, slug) values (v_org, 'Docs', 'docs');
  assert exists (select 1 from public.projects where organization_id = v_org and slug = 'docs');
  -- Recipients are not auto-verified
  insert into public.alert_email_recipients (channel_id, email, verified_at)
  values ((select id from public.alert_channels where legacy_config_id = '00000000-0000-0000-0000-00000000d001'), 'ops@elsewhere.example', now());
  assert (select verified_at from public.alert_email_recipients where email = 'ops@elsewhere.example') is null;
  -- Security definer RPCs keep working (recompute runs privileged inside them)
  v_incident := public.create_incident(tests.payments(), 'API incident', 'From CI', 'investigating', 'major', jsonb_build_object('webhooks', 'major_outage'), false, 'api', 'ci-key');
  assert (select status from public.components where id = tests.webhooks()) = 'major_outage', 'incident applied through the API';
  perform public.post_incident_update(v_incident.id, 'resolved', 'Done', 'public', null, false, 'ci-key');
  assert (select status from public.components where id = tests.webhooks()) = 'operational';
end $$;

-- Without the header the service role stays fully privileged (workers, cron)
select tests.as_service();
do $$
begin
  assert public.is_privileged_session();
  insert into public.monitors (project_id, name, type, interval_seconds, config) values (tests.blog(), 'Clamped', 'http', 60, '{"url": "https://blog.example.com"}');
  assert (select interval_seconds from public.monitors where name = 'Clamped') = 180, 'server writes are clamped, not rejected';
end $$;

-- The header means nothing for user or anonymous sessions
select tests.as_postgres();
create temporary table t_org as select organization_id from public.projects where id = tests.payments();
grant select on t_org to authenticated;
select tests.as_user(tests.mallory());
do $$
begin
  perform set_config('request.headers', '{"x-upvane-actor": "api_key:forged"}', true);
  assert public.request_api_actor() is null, 'forged header ignored for users';
  begin
    insert into public.projects (organization_id, name, slug) values ((select organization_id from t_org), 'Evil', 'evil');
    raise exception 'forged header bypassed the role check';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
