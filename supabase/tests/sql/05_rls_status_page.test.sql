-- RLS isolation, public status page data, private pages, custom domains, API keys (A-2, M-10, C-1)
begin;

-- C-1: the key mallory created against alice's project was revoked by the migration
do $$
begin
  assert (select revoked_at from public.api_keys where id = '00000000-0000-0000-0000-0000000a0002') is not null, 'stolen key revoked';
  assert (select revoked_at from public.api_keys where id = '00000000-0000-0000-0000-0000000a0001') is null, 'legitimate key kept';
  assert public.authenticate_api_key(repeat('b', 64)) is null, 'revoked key rejected';
  assert (public.authenticate_api_key(repeat('a', 64)))->>'plan' = 'pro';
end $$;

-- Anonymous visitors: no table access, status page through the function only
select tests.as_anon();
do $$
begin
  begin
    perform 1 from public.projects limit 1;
    raise exception 'anon read projects';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.incidents limit 1;
    raise exception 'anon read incidents';
  exception when insufficient_privilege then null;
  end;
end $$;

select tests.as_postgres();
create temporary table t_alice as select username as slug from public.profiles where id = tests.alice();
grant select on t_alice to anon, authenticated, service_role;

select tests.as_anon();
do $$
declare
  v_page jsonb;
  v_slug text := (select slug from t_alice);
begin
  v_page := public.get_status_page(v_slug, 'payments');
  assert v_page is not null, 'public page visible';
  assert (v_page->>'private')::boolean = false;
  assert v_page->'project'->>'name' = 'Payments';
  assert jsonb_array_length(v_page->'components') = 3;
  assert jsonb_array_length(v_page->'components'->0->'days') = 90, 'pro plan shows 90 days';
  assert v_page->>'overall_status' = 'partial_outage';
  assert jsonb_array_length(v_page->'active_incidents') = 1;
  assert (v_page->'active_incidents'->0->'updates'->0->>'message') = 'Root cause identified.';
  -- Internal notes are not published
  assert not exists (
    select 1 from jsonb_array_elements(v_page->'active_incidents'->0->'updates') u where u->>'message' like '%internal%'
  );
  assert public.get_status_page(v_slug, 'nope') is null;
  assert public.get_status_page_incident(v_slug, 'payments', '00000000-0000-0000-0000-00000000e002') is not null, '40 day old incident visible on a 90 day plan';
end $$;

-- Private pages: stub for strangers, full data for members and the server
select tests.as_postgres();
update public.organizations set plan = 'business' where id = (select organization_id from public.projects where id = tests.payments());
update public.projects set visibility = 'private' where id = tests.payments();

select tests.as_anon();
do $$
declare
  v_page jsonb := public.get_status_page((select slug from t_alice), 'payments');
begin
  assert (v_page->>'private')::boolean, 'private stub';
  assert v_page->'components' is null, 'no data leaked';
  assert public.get_status_page_history((select slug from t_alice), 'payments', null, 10) is null;
end $$;

select tests.as_user(tests.alice());
do $$
begin
  assert (public.get_status_page((select slug from t_alice), 'payments')->>'private')::boolean = false, 'member sees private page';
end $$;

select tests.as_service();
do $$
begin
  assert (public.get_status_page((select slug from t_alice), 'payments')->>'private')::boolean = false, 'server sees private page';
end $$;

-- Access tokens
select tests.as_postgres();
insert into public.status_page_access_tokens (project_id, name, token_hash, prefix) values (tests.payments(), 'Support team', 'hash-1', 'spat_');
select tests.as_service();
do $$
begin
  assert public.check_status_page_access(tests.payments(), 'hash-1');
  assert not public.check_status_page_access(tests.payments(), 'hash-2');
  assert not public.check_status_page_access(tests.blog(), 'hash-1');
end $$;

-- Custom domains: only verified domains resolve, users cannot verify themselves
select tests.as_user(tests.alice());
do $$
begin
  update public.projects set custom_domain = 'Status.Quillbase.io' where id = tests.payments();
  assert (select custom_domain_status from public.projects where id = tests.payments()) = 'pending';
  begin
    update public.projects set custom_domain_status = 'verified' where id = tests.payments();
    raise exception 'user verified a domain';
  exception when insufficient_privilege then null;
  end;
end $$;

select tests.as_anon();
do $$
begin
  assert public.resolve_custom_domain('status.quillbase.io') is null, 'pending domain does not resolve';
end $$;

select tests.as_postgres();
update public.projects set custom_domain_status = 'verified', custom_domain_verified_at = now() where id = tests.payments();
select tests.as_anon();
do $$
begin
  assert (public.resolve_custom_domain('status.quillbase.io:443'))->>'project_slug' = 'payments';
end $$;

-- Tenant isolation for authenticated users
select tests.as_user(tests.mallory());
do $$
begin
  assert not exists (select 1 from public.projects where id = tests.payments());
  assert not exists (select 1 from public.components where project_id = tests.payments());
  assert not exists (select 1 from public.monitors where project_id = tests.payments());
  assert not exists (select 1 from public.alert_channels where project_id = tests.payments());
  assert not exists (select 1 from public.api_keys where project_id = tests.payments());
  assert not exists (select 1 from public.monitor_secrets);
  -- C-1: clients can no longer create API keys at all
  begin
    insert into public.api_keys (organization_id, project_id, token_hash, name)
    values ((select organization_id from public.projects where id = tests.blog()), null, repeat('c', 64), 'x');
    raise exception 'client created an api key';
  exception when insufficient_privilege then null;
  end;
  -- Mallory cannot add components to someone else's page
  begin
    insert into public.components (project_id, name) values (tests.payments(), 'Injected');
    raise exception 'cross-tenant insert';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Free plan history window: bob's page shows 30 day bars and only 7 days of incidents
select tests.as_postgres();
do $$
declare
  v_page jsonb;
  v_bob text := (select username from public.profiles where id = tests.bob());
begin
  v_page := public.get_status_page(v_bob, 'blog');
  assert jsonb_array_length(v_page->'components'->0->'days') = 30, 'free plan shows 30 days of bars';
  assert (v_page->'project'->>'history_days')::integer = 7;
end $$;

rollback;
