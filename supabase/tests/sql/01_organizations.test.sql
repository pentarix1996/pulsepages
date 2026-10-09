-- Organizations, roles and plan protection (C-4)
begin;

do $$
declare
  v_org uuid;
  v_slug text;
  v_count integer;
begin
  -- Every legacy user got a personal organization whose slug is the username.
  select count(*) into v_count from public.organizations where personal;
  assert v_count = 3, format('expected 3 personal orgs, got %s', v_count);

  select o.id, o.slug into v_org, v_slug from public.organizations o
  join public.organization_members m on m.organization_id = o.id
  where m.user_id = tests.alice() and o.personal;
  assert v_slug = (select username from public.profiles where id = tests.alice()), 'personal org slug must equal username';
  assert (select plan from public.organizations where id = v_org) = 'pro', 'plan copied from profile';
  assert (select organization_id from public.projects where id = tests.payments()) = v_org, 'project moved to personal org';
  assert (select role from public.organization_members where organization_id = v_org and user_id = tests.alice()) = 'owner';
end $$;

-- A user cannot give themselves a better plan (C-4)
select tests.as_user(tests.alice());
do $$
begin
  begin
    update public.profiles set plan = 'business' where id = tests.alice();
    raise exception 'profile plan update should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organizations set plan = 'business' where created_by = tests.alice() and personal;
    raise exception 'organization plan update should fail';
  exception when insufficient_privilege then null;
  end;
  -- Name changes are fine
  update public.profiles set name = 'Alice A.' where id = tests.alice();
end $$;

-- Team organizations, invitations and role rules
do $$
declare
  v_org public.organizations;
  v_token text := 'invite-token-for-bob';
begin
  v_org := public.create_organization('Quillbase', 'quillbase');
  assert v_org.slug = 'quillbase' and v_org.plan = 'free';
  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
  values (v_org.id, 'bob@example.com', 'admin', encode(extensions.digest(v_token, 'sha256'), 'hex'), tests.alice());
end $$;

select tests.as_user(tests.mallory());
do $$
begin
  begin
    perform public.accept_invitation('invite-token-for-bob');
    raise exception 'mallory must not accept bob''s invitation';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.organizations where slug = 'quillbase'), 'mallory cannot see the org';
end $$;

select tests.as_user(tests.bob());
do $$
declare
  v_org uuid;
begin
  v_org := public.accept_invitation('invite-token-for-bob');
  assert public.org_role(v_org) = 'admin', 'bob joined as admin';
  -- Admins cannot make themselves owner
  begin
    update public.organization_members set role = 'owner' where organization_id = v_org and user_id = tests.bob();
    raise exception 'admin must not become owner';
  exception when insufficient_privilege then null;
  end;
  -- Admins cannot remove the owner
  begin
    delete from public.organization_members where organization_id = v_org and user_id = tests.alice();
    raise exception 'admin must not remove owner';
  exception when insufficient_privilege then null;
  end;
end $$;

select tests.as_user(tests.alice());
do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'quillbase');
begin
  -- The last owner cannot leave
  begin
    delete from public.organization_members where organization_id = v_org and user_id = tests.alice();
    raise exception 'last owner must not leave';
  exception when raise_exception then
    if sqlerrm not like '%at least one owner%' then raise; end if;
  end;
  -- Owners can promote, then leave
  update public.organization_members set role = 'owner' where organization_id = v_org and user_id = tests.bob();
  delete from public.organization_members where organization_id = v_org and user_id = tests.alice();
end $$;

-- Free plan allows a single status page per organization
select tests.as_user(tests.bob());
do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'quillbase');
begin
  insert into public.projects (organization_id, name, slug) values (v_org, 'Status', 'status');
  begin
    insert into public.projects (organization_id, name, slug) values (v_org, 'Second', 'second');
    raise exception 'second project on free plan should fail';
  exception when raise_exception then
    if sqlerrm not like '%allows 1 status page%' then raise; end if;
  end;
end $$;

-- New sign-ups get a personal organization too
select tests.as_postgres();
do $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data) values (v_user, 'newbie@example.com', '{"name": "New Bie"}');
  assert exists (select 1 from public.organizations o join public.organization_members m on m.organization_id = o.id where m.user_id = v_user and o.personal and m.role = 'owner');
end $$;

rollback;
