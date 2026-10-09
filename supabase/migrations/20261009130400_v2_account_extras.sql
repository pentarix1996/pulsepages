-- ==========================================
-- Migration: v2 account and organization settings helpers
-- ==========================================
-- Read helpers for the settings pages (members with their emails, plan usage) and the server-only plan change used
-- by POST /api/app/billing/plan. auth.users and auth.mfa_factors are not readable through RLS, so the member list is
-- a security definer function that only reveals emails to admins.

-- ------------------------------------------------------------------
-- Members of an organization, with emails for admins (and for the caller's own row)
-- ------------------------------------------------------------------
create or replace function public.organization_member_list(p_organization_id uuid)
returns table (
  user_id uuid,
  name text,
  username text,
  email text,
  role text,
  joined_at timestamptz,
  mfa_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.org_role(p_organization_id);
  v_admin boolean;
begin
  if v_role is null and not public.is_trusted_caller() then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;
  v_admin := v_role is null or public.org_role_rank(v_role) >= public.org_role_rank('admin');
  return query
    select
      m.user_id,
      p.name,
      p.username,
      case when v_admin or m.user_id = auth.uid() then u.email::text else null end,
      m.role,
      m.created_at,
      case when v_admin or m.user_id = auth.uid() then exists (
        select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status::text = 'verified'
      ) else null end
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id
    order by public.org_role_rank(m.role) desc, lower(coalesce(nullif(p.name, ''), p.username, u.email::text));
end;
$$;

-- ------------------------------------------------------------------
-- Plan usage of an organization (billing page and plan change preview)
-- ------------------------------------------------------------------
create or replace function public.organization_usage(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if public.org_role(p_organization_id) is null and not public.is_trusted_caller() then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;

  with org_projects as (
    select p.id, p.name, p.custom_domain, p.custom_domain_status, p.visibility, p.created_at
    from public.projects p where p.organization_id = p_organization_id
  ),
  org_monitors as (
    select m.enabled, m.paused_reason, m.type, m.interval_seconds, coalesce(cardinality(m.regions), 0) as regions
    from public.monitors m join org_projects p on p.id = m.project_id
  ),
  page_subscribers as (
    select p.id, p.name, p.created_at, count(s.id) as subscribers
    from org_projects p left join public.status_page_subscribers s on s.project_id = p.id
    group by p.id, p.name, p.created_at
  )
  select jsonb_build_object(
    'status_pages', (select count(*) from org_projects),
    'monitors_total', (select count(*) from org_monitors),
    'monitors_active', (select count(*) from org_monitors where enabled and paused_reason is null),
    'monitors_paused_by_plan', (select count(*) from org_monitors where enabled and paused_reason = 'plan_limit'),
    'monitors_interval_below', jsonb_build_object(
      '60', (select count(*) from org_monitors where type <> 'heartbeat' and interval_seconds < 60),
      '180', (select count(*) from org_monitors where type <> 'heartbeat' and interval_seconds < 180)
    ),
    'monitors_regions_above', jsonb_build_object(
      '1', (select count(*) from org_monitors where regions > 1),
      '3', (select count(*) from org_monitors where regions > 3)
    ),
    'members', (select count(*) from public.organization_members where organization_id = p_organization_id),
    'pending_invitations', (
      select count(*) from public.organization_invitations
      where organization_id = p_organization_id and accepted_at is null and revoked_at is null and expires_at > now()
    ),
    'largest_page', (
      select jsonb_build_object('project_id', s.id, 'name', s.name, 'subscribers', s.subscribers)
      from page_subscribers s order by s.subscribers desc, s.created_at asc limit 1
    ),
    'custom_domains', (select count(*) from org_projects where custom_domain is not null and custom_domain_status in ('pending', 'verified')),
    'private_pages', (select count(*) from org_projects where visibility = 'private'),
    'paging_channels', (
      select count(*) from public.alert_channels c join org_projects p on p.id = c.project_id
      where c.type in ('pagerduty', 'opsgenie')
    ),
    'api_keys_active', (
      select count(*) from public.api_keys k
      where k.organization_id = p_organization_id and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ------------------------------------------------------------------
-- Plan change (C-4): service role only. BILLING_MODE=demo calls it after checking the caller is an owner; a
-- billing webhook would call it too. organizations_after_plan_change() pauses monitors and clamps limits, then
-- writes billing.plan_changed as a system action; this function records who asked for the change on that row.
-- ------------------------------------------------------------------
create or replace function public.change_organization_plan(
  p_organization_id uuid,
  p_plan text,
  p_actor_id uuid default null,
  p_actor_label text default null,
  p_ip text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
  v_previous text;
  v_paused_before integer;
  v_paused_after integer;
  v_audit_id bigint;
begin
  if p_plan is null or p_plan not in ('free', 'pro', 'business') then
    raise exception 'Choose the free, pro or business plan.' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;
  v_previous := v_org.plan;
  if v_previous = p_plan then
    return jsonb_build_object('plan', p_plan, 'previous_plan', v_previous, 'changed', false, 'paused_monitors', 0, 'resumed_monitors', 0);
  end if;

  select count(*) into v_paused_before
  from public.monitors m join public.projects p on p.id = m.project_id
  where p.organization_id = p_organization_id and m.paused_reason = 'plan_limit';

  update public.organizations set plan = p_plan where id = p_organization_id;

  select count(*) into v_paused_after
  from public.monitors m join public.projects p on p.id = m.project_id
  where p.organization_id = p_organization_id and m.paused_reason = 'plan_limit';

  select max(id) into v_audit_id from public.audit_logs
  where organization_id = p_organization_id and action = 'billing.plan_changed';
  if v_audit_id is not null and p_actor_id is not null then
    update public.audit_logs
    set actor_type = 'user',
        actor_id = p_actor_id::text,
        actor_label = coalesce(p_actor_label, actor_label),
        ip = coalesce(p_ip, ip),
        metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
    where id = v_audit_id;
  end if;

  return jsonb_build_object(
    'plan', p_plan,
    'previous_plan', v_previous,
    'changed', true,
    'paused_monitors', greatest(v_paused_after - v_paused_before, 0),
    'resumed_monitors', greatest(v_paused_before - v_paused_after, 0)
  );
end;
$$;

-- ------------------------------------------------------------------
-- Function privileges
-- ------------------------------------------------------------------
revoke execute on function public.organization_member_list(uuid) from public, anon;
grant execute on function public.organization_member_list(uuid) to authenticated, service_role;
revoke execute on function public.organization_usage(uuid) from public, anon;
grant execute on function public.organization_usage(uuid) to authenticated, service_role;
revoke execute on function public.change_organization_plan(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.change_organization_plan(uuid, text, uuid, text, text, jsonb) to service_role;
