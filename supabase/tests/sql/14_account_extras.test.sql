-- Settings helpers: member list with emails, plan usage and the server-only plan change
begin;

-- Supabase provides auth.mfa_factors; the throwaway test database only has the stub auth schema.
do $$
begin
  if to_regclass('auth.mfa_factors') is null then
    create table auth.mfa_factors (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      factor_type text not null default 'totp',
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  end if;
end $$;

-- Alice creates a team and invites Bob as a viewer
select tests.as_user(tests.alice());
do $$
declare
  v_org public.organizations;
begin
  v_org := public.create_organization('Acme Settings', 'acme-settings');
  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
  values (v_org.id, 'bob@example.com', 'viewer', encode(extensions.digest('settings-invite-bob', 'sha256'), 'hex'), tests.alice());
end $$;

select tests.as_user(tests.bob());
select public.accept_invitation('settings-invite-bob');

select tests.as_postgres();
insert into auth.mfa_factors (user_id, factor_type, status, created_at, updated_at) values (tests.alice(), 'totp', 'verified', now(), now());
create temporary table t_settings_org as select id from public.organizations where slug = 'acme-settings';
grant select on t_settings_org to authenticated, service_role;

-- Admins see every member with email and 2FA status, owners first
select tests.as_user(tests.alice());
do $$
declare
  v_org uuid := (select id from t_settings_org);
begin
  assert (select count(*) from public.organization_member_list(v_org)) = 2, 'two members';
  assert (select role from public.organization_member_list(v_org) limit 1) = 'owner', 'owners first';
  assert (select email from public.organization_member_list(v_org) where user_id = tests.bob()) = 'bob@example.com', 'admins see emails';
  assert (select mfa_enabled from public.organization_member_list(v_org) where user_id = tests.alice()), 'a verified factor reads as 2FA on';
  assert not (select mfa_enabled from public.organization_member_list(v_org) where user_id = tests.bob()), 'no factor reads as 2FA off';
end $$;

-- Viewers see names and roles, and only their own email
select tests.as_user(tests.bob());
do $$
declare
  v_org uuid := (select id from t_settings_org);
begin
  assert (select count(*) from public.organization_member_list(v_org)) = 2, 'viewers see the member list';
  assert (select email from public.organization_member_list(v_org) where user_id = tests.alice()) is null, 'viewers do not see other emails';
  assert (select mfa_enabled from public.organization_member_list(v_org) where user_id = tests.alice()) is null, 'viewers do not see 2FA status';
  assert (select email from public.organization_member_list(v_org) where user_id = tests.bob()) = 'bob@example.com', 'everyone sees their own email';
  assert (public.organization_usage(v_org) ->> 'members')::int = 2, 'members can read usage';
end $$;

-- Strangers get "not found"
select tests.as_user(tests.mallory());
do $$
declare
  v_org uuid := (select id from t_settings_org);
begin
  begin
    perform * from public.organization_member_list(v_org);
    raise exception 'non-members must not list members';
  exception when no_data_found then null;
  end;
  begin
    perform public.organization_usage(v_org);
    raise exception 'non-members must not read usage';
  exception when no_data_found then null;
  end;
end $$;

-- Usage counts what the plan limits
select tests.as_user(tests.alice());
do $$
declare
  v_personal uuid := (select id from public.organizations where created_by = tests.alice() and personal);
  v_usage jsonb := public.organization_usage(v_personal);
begin
  assert (v_usage ->> 'status_pages')::int = (select count(*) from public.projects where organization_id = v_personal), 'status pages';
  assert (v_usage ->> 'members')::int = 1, 'one member in the personal workspace';
  assert (v_usage -> 'largest_page' ->> 'name') = 'Payments', 'largest page by subscribers';
  assert (v_usage ->> 'monitors_total')::int = (
    select count(*) from public.monitors m join public.projects p on p.id = m.project_id where p.organization_id = v_personal
  ), 'monitors';
  assert (public.organization_usage((select id from t_settings_org)) ->> 'pending_invitations')::int = 0, 'accepted invitations are not pending';
end $$;

-- Users cannot change plans, not even through the helper (C-4)
do $$
begin
  begin
    perform public.change_organization_plan((select id from t_settings_org), 'business', tests.alice(), 'Alice', null, '{}'::jsonb);
    raise exception 'users must not call change_organization_plan';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A status page with 7 monitors on Pro
select tests.as_user(tests.alice());
insert into public.projects (organization_id, name, slug) values ((select id from t_settings_org), 'Acme status', 'acme-status');

select tests.as_service();
do $$
declare
  v_org uuid := (select id from t_settings_org);
  v_project uuid := (select id from public.projects where organization_id = (select id from t_settings_org));
  v_result jsonb;
begin
  v_result := public.change_organization_plan(v_org, 'pro', tests.alice(), 'Alice Admin', '203.0.113.7', '{"request_id": "req_test"}'::jsonb);
  assert (v_result ->> 'changed')::boolean and v_result ->> 'previous_plan' = 'free', 'upgraded to pro';
  for i in 1..7 loop
    insert into public.monitors (project_id, name, type, interval_seconds, config, created_at)
    values (v_project, 'Check ' || i, 'http', 60, '{"url": "https://acme.example.com"}', now() - make_interval(mins => 10 - i));
  end loop;
  assert (select count(*) from public.monitors where project_id = v_project and enabled and paused_reason is null) = 7, '7 active monitors on pro';

  -- Downgrade: the 2 newest monitors pause, intervals rise to the Free minimum, the audit row names the owner
  v_result := public.change_organization_plan(v_org, 'free', tests.alice(), 'Alice Admin', '203.0.113.7', '{"request_id": "req_test"}'::jsonb);
  assert (v_result ->> 'paused_monitors')::int = 2, format('expected 2 paused monitors, got %s', v_result);
  assert (select plan from public.organizations where id = v_org) = 'free';
  assert (select count(*) from public.monitors where project_id = v_project and paused_reason = 'plan_limit') = 2;
  assert not exists (select 1 from public.monitors where project_id = v_project and paused_reason = 'plan_limit' and name in ('Check 1', 'Check 2')), 'newest monitors pause first';
  assert (select min(interval_seconds) from public.monitors where project_id = v_project) = 180, 'intervals clamped to the free minimum';
  assert (
    select actor_type = 'user' and actor_id = tests.alice()::text and actor_label = 'Alice Admin' and ip = '203.0.113.7' and metadata ->> 'request_id' = 'req_test'
      and metadata ->> 'from' = 'pro' and metadata ->> 'to' = 'free'
    from public.audit_logs where organization_id = v_org and action = 'billing.plan_changed' order by id desc limit 1
  ), 'billing.plan_changed records who asked for it';

  -- Upgrading again resumes them; asking for the current plan changes nothing
  v_result := public.change_organization_plan(v_org, 'pro', tests.alice(), 'Alice Admin', null, '{}'::jsonb);
  assert (v_result ->> 'resumed_monitors')::int = 2, format('expected 2 resumed monitors, got %s', v_result);
  v_result := public.change_organization_plan(v_org, 'pro', tests.alice(), 'Alice Admin', null, '{}'::jsonb);
  assert not (v_result ->> 'changed')::boolean, 'same plan is a no-op';

  begin
    perform public.change_organization_plan(v_org, 'enterprise', null, null, null, '{}'::jsonb);
    raise exception 'unknown plans must fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
