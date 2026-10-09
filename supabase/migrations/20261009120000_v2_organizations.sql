-- ==========================================
-- Migration: v2 organizations, roles, plans and audit log
-- ==========================================
-- Every user gets a personal organization (slug = username, so /status/{username}/{slug} keeps working).
-- Projects belong to organizations. Plans move to organizations and can only be changed by service_role (C-4).

-- ------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  personal boolean not null default false,
  sso_domain text,
  require_2fa boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organizations_slug_key on public.organizations (lower(slug));

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'responder', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx on public.organization_members (user_id);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null check (role in ('owner', 'admin', 'responder', 'viewer')),
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_invitations_org_idx on public.organization_invitations (organization_id, created_at desc);

create table if not exists public.audit_logs (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'api_key', 'system')),
  actor_id text,
  actor_label text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_project_created_idx on public.audit_logs (project_id, created_at desc);

alter table public.projects add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.audit_logs enable row level security;

-- ------------------------------------------------------------------
-- Plan limits (mirror of supabase/functions/_shared/plans.ts)
-- ------------------------------------------------------------------
create or replace function public.plan_limit(p_plan text, p_key text)
returns integer
language sql
immutable
as $$
  -- -1 means unlimited.
  select case p_key
    when 'projects' then case p_plan when 'business' then -1 when 'pro' then 5 else 1 end
    when 'components_per_project' then case p_plan when 'business' then -1 when 'pro' then 50 else 10 end
    when 'monitors' then case p_plan when 'business' then 100 when 'pro' then 30 else 5 end
    when 'min_interval_seconds' then case p_plan when 'business' then 30 when 'pro' then 60 else 180 end
    when 'regions_per_monitor' then case p_plan when 'business' then -1 when 'pro' then 3 else 1 end
    when 'subscribers_per_project' then case p_plan when 'business' then -1 when 'pro' then 2000 else 100 end
    when 'history_days' then case p_plan when 'business' then 365 when 'pro' then 90 else 7 end
    when 'members' then case p_plan when 'business' then -1 when 'pro' then 10 else 3 end
    when 'api' then case p_plan when 'free' then 0 else 1 end
    when 'custom_domain' then case p_plan when 'free' then 0 else 1 end
    when 'private_pages' then case p_plan when 'business' then 1 else 0 end
    when 'paging_channels' then case p_plan when 'business' then 1 else 0 end
    when 'sso' then case p_plan when 'business' then 1 else 0 end
    else 0
  end
$$;

-- ------------------------------------------------------------------
-- Role helpers (security definer so RLS policies can use them without recursion)
-- ------------------------------------------------------------------
create or replace function public.org_role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role when 'owner' then 4 when 'admin' then 3 when 'responder' then 2 when 'viewer' then 1 else 0 end
$$;

create or replace function public.org_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.organization_members m where m.organization_id = p_org and m.user_id = auth.uid()
$$;

create or replace function public.has_org_role(p_org uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and public.org_role_rank(m.role) >= public.org_role_rank(p_min_role)
  )
$$;

create or replace function public.has_project_role(p_project uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = p_project
      and m.user_id = auth.uid()
      and public.org_role_rank(m.role) >= public.org_role_rank(p_min_role)
  )
$$;

create or replace function public.is_privileged_session()
returns boolean
language sql
stable
as $$
  -- true for service_role, postgres and security definer code; false for PostgREST anon/authenticated sessions.
  select current_user not in ('anon', 'authenticated')
$$;

-- For security definer functions (where current_user is always the owner): true for the service role, cron and
-- migrations, false for requests made with a user or anon JWT.
create or replace function public.is_trusted_caller()
returns boolean
language sql
stable
as $$
  select auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated')
$$;

create or replace function public.unique_org_slug(p_base text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := left(public.slugify(p_base), 40);
  v_candidate text;
begin
  if v_base is null or char_length(v_base) < 2 then v_base := 'team'; end if;
  v_candidate := v_base;
  while exists (select 1 from public.organizations where lower(slug) = lower(v_candidate)) loop
    v_candidate := v_base || '-' || substr(md5(random()::text), 1, 5);
  end loop;
  return v_candidate;
end;
$$;

-- ------------------------------------------------------------------
-- Backfill: one personal organization per profile
-- ------------------------------------------------------------------

do $$
declare
  v_profile record;
  v_org uuid;
  v_slug text;
begin
  for v_profile in
    select p.id, p.name, p.username, coalesce(p.plan, 'free') as plan
    from public.profiles p
    where not exists (
      select 1 from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = p.id and o.personal
    )
  loop
    v_slug := coalesce(nullif(v_profile.username, ''), public.unique_org_slug(coalesce(v_profile.name, 'workspace')));
    if exists (select 1 from public.organizations where lower(slug) = lower(v_slug)) then
      v_slug := public.unique_org_slug(v_slug);
    end if;
    insert into public.organizations (name, slug, plan, personal, created_by)
    values (coalesce(nullif(v_profile.name, ''), v_slug), v_slug,
            case when v_profile.plan in ('free', 'pro', 'business') then v_profile.plan else 'free' end,
            true, v_profile.id)
    returning id into v_org;
    insert into public.organization_members (organization_id, user_id, role) values (v_org, v_profile.id, 'owner');
  end loop;
end $$;

update public.projects p
set organization_id = (
  select o.id from public.organizations o
  join public.organization_members m on m.organization_id = o.id
  where m.user_id = p.user_id and o.personal
  order by o.created_at
  limit 1
)
where p.organization_id is null;

alter table public.projects alter column organization_id set not null;
create index if not exists projects_organization_idx on public.projects (organization_id);
create unique index if not exists projects_org_slug_key on public.projects (organization_id, slug);
alter table public.projects alter column user_id drop not null;

-- ------------------------------------------------------------------
-- Guards: plan and username are not user-editable (C-4)
-- ------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_privileged_session() then
    if new.plan is distinct from old.plan then
      raise exception 'The plan can only be changed through billing.' using errcode = '42501';
    end if;
    if new.username is distinct from old.username then
      raise exception 'The username cannot be changed.' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'The profile id cannot be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns before update on public.profiles
for each row execute procedure public.protect_profile_columns();

create or replace function public.protect_organization_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_privileged_session() then
    if new.plan is distinct from old.plan then
      raise exception 'The plan can only be changed through billing.' using errcode = '42501';
    end if;
    if new.personal is distinct from old.personal or new.created_by is distinct from old.created_by or new.id is distinct from old.id then
      raise exception 'This organization field cannot be changed.' using errcode = '42501';
    end if;
    if new.slug is distinct from old.slug and old.personal then
      raise exception 'The slug of a personal workspace follows the username.' using errcode = '42501';
    end if;
    if (new.sso_domain is distinct from old.sso_domain or new.require_2fa is distinct from old.require_2fa)
       and not public.has_org_role(old.id, 'owner') then
      raise exception 'Only owners can change security settings.' using errcode = '42501';
    end if;
    if new.sso_domain is distinct from old.sso_domain and new.sso_domain is not null and public.plan_limit(old.plan, 'sso') = 0 then
      raise exception 'SSO requires the Business plan.' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  if new.slug is distinct from old.slug then
    new.slug := lower(new.slug);
    if new.slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
      raise exception 'Use 2-63 lowercase letters, numbers or hyphens for the slug.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_organization_columns on public.organizations;
create trigger protect_organization_columns before update on public.organizations
for each row execute procedure public.protect_organization_columns();

-- Keep profiles.plan in sync with the personal organization (read by old clients only).
create or replace function public.sync_personal_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.personal and new.plan is distinct from old.plan and new.created_by is not null then
    update public.profiles set plan = new.plan where id = new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_personal_plan on public.organizations;
create trigger sync_personal_plan after update of plan on public.organizations
for each row execute procedure public.sync_personal_plan();

-- Membership invariants: someone always owns the organization; only owners manage owners.
create or replace function public.protect_organization_members()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor_role text;
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_owner_count integer;
begin
  -- Security definer RPCs (create_organization, accept_invitation) and service_role are trusted;
  -- direct PostgREST writes are checked against the actor's role.
  if not public.is_privileged_session() then
    v_actor_role := public.org_role(v_org);
    if v_actor_role is null then
      raise exception 'Not a member of this organization.' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' and old.user_id = auth.uid() then
      null; -- leaving is allowed (the last-owner rule below still applies)
    elsif public.org_role_rank(v_actor_role) < public.org_role_rank('admin') then
      raise exception 'Only admins can manage members.' using errcode = '42501';
    elsif v_actor_role <> 'owner' and (
      (tg_op in ('UPDATE', 'DELETE') and old.role = 'owner') or
      (tg_op in ('INSERT', 'UPDATE') and new.role = 'owner')
    ) then
      raise exception 'Only owners can grant or remove the owner role.' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into v_owner_count from public.organization_members
    where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id;
    if v_owner_count = 0 and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'An organization needs at least one owner.' using errcode = 'P0001';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists protect_organization_members on public.organization_members;
create trigger protect_organization_members before insert or update or delete on public.organization_members
for each row execute procedure public.protect_organization_members();

-- ------------------------------------------------------------------
-- New users: profile + personal organization
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_username text;
  v_org uuid;
  v_slug text;
begin
  v_username := public.generate_unique_username(coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  while exists (select 1 from public.organizations where lower(slug) = lower(v_username)) loop
    v_username := public.generate_unique_username(v_username || '-' || substr(md5(random()::text), 1, 3));
  end loop;

  insert into public.profiles (id, name, username, plan)
  values (new.id, new.raw_user_meta_data->>'name', v_username, 'free')
  on conflict (id) do nothing;

  select username into v_slug from public.profiles where id = new.id;
  insert into public.organizations (name, slug, plan, personal, created_by)
  values (coalesce(nullif(new.raw_user_meta_data->>'name', ''), v_slug), v_slug, 'free', true, new.id)
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text default null)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
  v_slug text;
begin
  if auth.uid() is null then raise exception 'Not authenticated.' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) < 2 or char_length(trim(p_name)) > 80 then
    raise exception 'Use 2-80 characters for the name.' using errcode = '22023';
  end if;
  if p_slug is not null and p_slug <> '' then
    v_slug := lower(p_slug);
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
      raise exception 'Use 2-63 lowercase letters, numbers or hyphens for the slug.' using errcode = '22023';
    end if;
    if exists (select 1 from public.organizations where lower(slug) = v_slug) then
      raise exception 'That slug is already taken.' using errcode = '23505';
    end if;
  else
    v_slug := public.unique_org_slug(p_name);
  end if;
  insert into public.organizations (name, slug, plan, personal, created_by)
  values (trim(p_name), v_slug, 'free', false, auth.uid())
  returning * into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  insert into public.audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id)
  values (v_org.id, 'user', auth.uid()::text, 'organization.created', 'organization', v_org.id::text);
  return v_org;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.organization_invitations;
  v_email text;
  v_plan text;
  v_members integer;
  v_limit integer;
begin
  if auth.uid() is null then raise exception 'Sign in to accept the invitation.' using errcode = '42501'; end if;
  select * into v_invite from public.organization_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found or v_invite.revoked_at is not null then
    raise exception 'This invitation is not valid.' using errcode = 'P0002';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invitation was already used.' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from v_invite.email then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;
  select plan into v_plan from public.organizations where id = v_invite.organization_id;
  v_limit := public.plan_limit(v_plan, 'members');
  select count(*) into v_members from public.organization_members where organization_id = v_invite.organization_id;
  if v_limit <> -1 and v_members >= v_limit then
    raise exception 'This organization has reached its member limit.' using errcode = 'P0001';
  end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, user_id) do update set role = excluded.role
  where public.org_role_rank(excluded.role) > public.org_role_rank(organization_members.role);
  update public.organization_invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_invite.id;
  insert into public.audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id, metadata)
  values (v_invite.organization_id, 'user', auth.uid()::text, 'member.joined', 'user', auth.uid()::text, jsonb_build_object('role', v_invite.role, 'invitation_id', v_invite.id));
  return v_invite.organization_id;
end;
$$;

create or replace function public.write_audit_log(
  p_organization_id uuid,
  p_project_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actor_label text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb,
  p_ip text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (organization_id, project_id, actor_type, actor_id, actor_label, action, target_type, target_id, metadata, ip)
  values (p_organization_id, p_project_id, p_actor_type, p_actor_id, p_actor_label, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb), p_ip)
$$;

-- ------------------------------------------------------------------
-- Projects follow organization plans
-- ------------------------------------------------------------------
create or replace function public.enforce_project_limits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan text;
  v_count integer;
  v_limit integer;
begin
  if new.organization_id is null then
    select o.id into new.organization_id from public.organizations o
    join public.organization_members m on m.organization_id = o.id
    where m.user_id = coalesce(new.user_id, auth.uid()) and o.personal
    limit 1;
  end if;
  if new.organization_id is null then
    raise exception 'Choose an organization for the project.' using errcode = '23502';
  end if;
  if not public.is_privileged_session() and not public.has_org_role(new.organization_id, 'admin') then
    raise exception 'Only admins can create projects.' using errcode = '42501';
  end if;
  select plan into v_plan from public.organizations where id = new.organization_id;
  v_limit := public.plan_limit(v_plan, 'projects');
  select count(*) into v_count from public.projects where organization_id = new.organization_id;
  if v_limit <> -1 and v_count >= v_limit then
    raise exception 'Your % plan allows % status page%. Upgrade to add more.', v_plan, v_limit, case when v_limit = 1 then '' else 's' end
      using errcode = 'P0001';
  end if;
  if new.user_id is null then new.user_id := auth.uid(); end if;
  new.slug := lower(new.slug);
  if new.slug !~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$' then
    raise exception 'Use 2-64 lowercase letters, numbers or hyphens for the slug.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists check_project_limit_trigger on public.projects;
create trigger check_project_limit_trigger
  before insert on public.projects
  for each row execute procedure public.enforce_project_limits();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_projects_updated_at on public.projects;
create trigger touch_projects_updated_at before update on public.projects
for each row execute procedure public.touch_updated_at();

-- Old reset RPC now clears the caller's personal workspace only.
create or replace function public.reset_user_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated.' using errcode = '42501'; end if;
  delete from public.projects p
  using public.organizations o
  where o.id = p.organization_id and o.personal and o.created_by = auth.uid();
end;
$$;

-- ------------------------------------------------------------------
-- Function privileges
-- ------------------------------------------------------------------
revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated, service_role;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated, service_role;
revoke execute on function public.write_audit_log(uuid, uuid, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_audit_log(uuid, uuid, text, text, text, text, text, text, jsonb, text) to service_role;
revoke execute on function public.unique_org_slug(text) from public, anon, authenticated;
revoke execute on function public.generate_unique_username(text) from public, anon, authenticated;
revoke execute on function public.reset_user_data() from public, anon;
grant execute on function public.reset_user_data() to authenticated;
