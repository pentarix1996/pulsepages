-- ==========================================
-- Migration: v2 public status page data, private pages, custom domains, API keys, rate limits, idempotency
-- ==========================================
-- The status page no longer reads base tables anonymously (A-2, M-10): get_status_page() returns only what the page
-- shows, trims history by plan and refuses private pages to non-members.

alter table public.projects drop constraint if exists projects_visibility_check;
alter table public.projects add constraint projects_visibility_check check (visibility in ('public', 'private'));
alter table public.projects drop constraint if exists projects_theme_default_check;
alter table public.projects add constraint projects_theme_default_check check (theme_default in ('light', 'dark', 'system'));
alter table public.projects drop constraint if exists projects_custom_domain_status_check;
alter table public.projects add constraint projects_custom_domain_status_check check (custom_domain_status in ('none', 'pending', 'verified', 'error', 'suspended'));
alter table public.projects drop constraint if exists projects_brand_color_check;
alter table public.projects add constraint projects_brand_color_check check (brand_color is null or brand_color ~* '^#[0-9a-f]{6}$');
alter table public.projects drop constraint if exists projects_custom_domain_check;
alter table public.projects add constraint projects_custom_domain_check
  check (custom_domain is null or custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');
create unique index if not exists projects_custom_domain_key on public.projects (custom_domain) where custom_domain is not null;

create or replace function public.projects_guard_settings()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan text;
begin
  if public.is_privileged_session() then
    return new;
  end if;
  select plan into v_plan from public.organizations where id = new.organization_id;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Projects cannot move between organizations.' using errcode = '42501';
  end if;
  if new.visibility = 'private' and old.visibility <> 'private' and public.plan_limit(v_plan, 'private_pages') = 0 then
    raise exception 'Private status pages require the Business plan.' using errcode = 'P0001';
  end if;
  if new.custom_domain is distinct from old.custom_domain then
    if new.custom_domain is not null and public.plan_limit(v_plan, 'custom_domain') = 0 then
      raise exception 'Custom domains require the Pro plan.' using errcode = 'P0001';
    end if;
    new.custom_domain := lower(new.custom_domain);
    new.custom_domain_status := case when new.custom_domain is null then 'none' else 'pending' end;
    new.custom_domain_verified_at := null;
    new.custom_domain_error := null;
  elsif new.custom_domain_status is distinct from old.custom_domain_status or new.custom_domain_verified_at is distinct from old.custom_domain_verified_at then
    raise exception 'Domain verification is handled by Upvane.' using errcode = '42501';
  end if;
  if (new.hide_powered_by or new.brand_color is not null or new.logo_url is not null)
     and (new.hide_powered_by is distinct from old.hide_powered_by or new.brand_color is distinct from old.brand_color or new.logo_url is distinct from old.logo_url)
     and public.plan_limit(v_plan, 'custom_domain') = 0 then
    raise exception 'Branding requires the Pro plan.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_settings on public.projects;
create trigger projects_guard_settings before update on public.projects
for each row execute procedure public.projects_guard_settings();

create table if not exists public.status_page_access_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  prefix text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index if not exists status_page_access_tokens_project_idx on public.status_page_access_tokens (project_id);
alter table public.status_page_access_tokens enable row level security;

-- ------------------------------------------------------------------
-- Status page data
-- ------------------------------------------------------------------
create or replace function public.status_page_project(p_org_slug text, p_project_slug text)
returns table(project public.projects, org public.organizations)
language sql
stable
security definer
set search_path = public
as $$
  select p, o from public.projects p join public.organizations o on o.id = p.organization_id
  where lower(o.slug) = lower(p_org_slug) and p.slug = lower(p_project_slug)
  limit 1
$$;

create or replace function public.status_page_can_read(p_project public.projects)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_project.visibility = 'public' or public.is_trusted_caller() or public.has_org_role(p_project.organization_id, 'viewer')
$$;

create or replace function public.status_page_incident_json(p_incident public.incidents, p_include_updates boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_incident.id,
    'title', p_incident.title,
    'status', p_incident.status,
    'impact', p_incident.impact,
    'started_at', coalesce(p_incident.published_at, p_incident.created_at),
    'resolved_at', p_incident.resolved_at,
    'updated_at', p_incident.updated_at,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', ic.status) order by c.position, c.name)
      from public.incident_components ic join public.components c on c.id = ic.component_id
      where ic.incident_id = p_incident.id
    ), '[]'::jsonb),
    'updates', case when p_include_updates then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'status', u.status, 'message', u.message, 'created_at', u.created_at, 'components', u.component_statuses) order by u.created_at desc)
      from public.incident_updates u
      where u.incident_id = p_incident.id and u.visibility = 'public' and u.kind = 'update'
    ), '[]'::jsonb) else (
      select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'status', u.status, 'message', u.message, 'created_at', u.created_at)), '[]'::jsonb)
      from (
        select * from public.incident_updates u
        where u.incident_id = p_incident.id and u.visibility = 'public' and u.kind = 'update'
        order by u.created_at desc limit 1
      ) u
    ) end,
    'postmortem', (
      select jsonb_build_object('summary', pm.summary, 'impact', pm.impact, 'root_cause', pm.root_cause, 'resolution', pm.resolution, 'lessons', pm.lessons, 'published_at', pm.published_at)
      from public.postmortems pm where pm.incident_id = p_incident.id and pm.status = 'published'
    )
  )
$$;

create or replace function public.status_page_maintenance_json(p_maintenance public.maintenances)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_maintenance.id,
    'title', p_maintenance.title,
    'description', p_maintenance.description,
    'status', p_maintenance.status,
    'scheduled_start', p_maintenance.scheduled_start,
    'scheduled_end', p_maintenance.scheduled_end,
    'actual_start', p_maintenance.actual_start,
    'actual_end', p_maintenance.actual_end,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.position, c.name)
      from public.maintenance_components mc join public.components c on c.id = mc.component_id
      where mc.maintenance_id = p_maintenance.id
    ), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'status', u.status, 'message', u.message, 'created_at', u.created_at) order by u.created_at desc)
      from public.maintenance_updates u where u.maintenance_id = p_maintenance.id
    ), '[]'::jsonb)
  )
$$;

create or replace function public.get_status_page(p_org_slug text, p_project_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_org public.organizations;
  v_history_days integer;
  v_bar_days integer;
  v_component_ids uuid[];
  v_result jsonb;
begin
  select (x.project).* into v_project from public.status_page_project(p_org_slug, p_project_slug) x;
  if v_project.id is null then
    return null;
  end if;
  select * into v_org from public.organizations where id = v_project.organization_id;

  if not public.status_page_can_read(v_project) then
    return jsonb_build_object(
      'private', true,
      'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'slug', v_project.slug,
        'organization_slug', v_org.slug, 'organization_name', v_org.name, 'sso_domain', v_org.sso_domain,
        'brand_color', v_project.brand_color, 'logo_url', v_project.logo_url)
    );
  end if;

  v_history_days := public.plan_limit(v_org.plan, 'history_days');
  v_bar_days := least(90, greatest(v_history_days, 30));
  select coalesce(array_agg(id), '{}'::uuid[]) into v_component_ids from public.components where project_id = v_project.id;

  select jsonb_build_object(
    'private', false,
    'generated_at', now(),
    'project', jsonb_build_object(
      'id', v_project.id, 'name', v_project.name, 'slug', v_project.slug, 'description', v_project.description,
      'organization_slug', v_org.slug, 'organization_name', v_org.name,
      'visibility', v_project.visibility,
      'brand_color', v_project.brand_color, 'logo_url', v_project.logo_url, 'theme_default', v_project.theme_default,
      'timezone', v_project.timezone, 'support_url', v_project.support_url,
      'hide_powered_by', v_project.hide_powered_by and public.plan_limit(v_org.plan, 'custom_domain') = 1,
      'custom_domain', case when v_project.custom_domain_status = 'verified' then v_project.custom_domain else null end,
      'history_days', v_history_days,
      'bar_days', v_bar_days
    ),
    'overall_status', coalesce((
      select (array_agg(c.status order by public.status_rank(c.status) desc))[1] from public.components c where c.project_id = v_project.id
    ), 'operational'),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'position', g.position, 'collapsed', g.collapsed) order by g.position, g.name)
      from public.component_groups g where g.project_id = v_project.id
    ), '[]'::jsonb),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug, 'description', c.description, 'status', c.status,
        'group_id', c.group_id, 'position', c.position,
        'uptime', public.component_uptime(c.id, now() - make_interval(days => v_bar_days), now()),
        'days', coalesce((
          select jsonb_agg(jsonb_build_object(
            'date', ds.day, 'status', ds.worst_status,
            'downtime_minutes', round(ds.downtime_seconds / 60),
            'major_minutes', round(ds.major_seconds / 60),
            'partial_minutes', round(ds.partial_seconds / 60),
            'degraded_minutes', round(ds.degraded_seconds / 60),
            'maintenance_minutes', round(ds.maintenance_seconds / 60),
            'incidents', coalesce((
              select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'impact', i.impact))
              from public.incidents i where i.id = any(ds.incident_ids)
                and coalesce(i.published_at, i.created_at) > now() - make_interval(days => v_history_days)
            ), '[]'::jsonb)
          ) order by ds.day)
          from public.component_daily_status(array[c.id], v_bar_days, v_project.timezone) ds
        ), '[]'::jsonb)
      ) order by c.position, c.name)
      from public.components c where c.project_id = v_project.id
    ), '[]'::jsonb),
    'active_incidents', coalesce((
      select jsonb_agg(public.status_page_incident_json(i, true) order by i.created_at desc)
      from public.incidents i
      where i.project_id = v_project.id and i.deleted_at is null and i.status in ('investigating', 'identified', 'monitoring')
    ), '[]'::jsonb),
    'maintenances', coalesce((
      select jsonb_agg(public.status_page_maintenance_json(m) order by m.scheduled_start)
      from public.maintenances m
      where m.project_id = v_project.id and m.status in ('scheduled', 'in_progress')
    ), '[]'::jsonb),
    'recent_incidents', coalesce((
      select jsonb_agg(public.status_page_incident_json(i, false) order by coalesce(i.published_at, i.created_at) desc)
      from public.incidents i
      where i.project_id = v_project.id and i.deleted_at is null and i.status = 'resolved'
        and coalesce(i.published_at, i.created_at) > now() - make_interval(days => least(7, v_history_days))
    ), '[]'::jsonb),
    'recent_maintenances', coalesce((
      select jsonb_agg(public.status_page_maintenance_json(m) order by m.scheduled_start desc)
      from public.maintenances m
      where m.project_id = v_project.id and m.status = 'completed' and m.scheduled_start > now() - make_interval(days => least(7, v_history_days))
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_status_page_incident(p_org_slug text, p_project_slug text, p_incident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_org public.organizations;
  v_incident public.incidents;
begin
  select (x.project).* into v_project from public.status_page_project(p_org_slug, p_project_slug) x;
  if v_project.id is null or not public.status_page_can_read(v_project) then
    return null;
  end if;
  select * into v_org from public.organizations where id = v_project.organization_id;
  select * into v_incident from public.incidents
  where id = p_incident_id and project_id = v_project.id and deleted_at is null and status <> 'draft'
    and (status <> 'resolved' or coalesce(published_at, created_at) > now() - make_interval(days => public.plan_limit(v_org.plan, 'history_days')));
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'slug', v_project.slug, 'organization_slug', v_org.slug,
      'brand_color', v_project.brand_color, 'logo_url', v_project.logo_url, 'theme_default', v_project.theme_default, 'timezone', v_project.timezone,
      'hide_powered_by', v_project.hide_powered_by and public.plan_limit(v_org.plan, 'custom_domain') = 1,
      'custom_domain', case when v_project.custom_domain_status = 'verified' then v_project.custom_domain else null end),
    'incident', public.status_page_incident_json(v_incident, true)
  );
end;
$$;

create or replace function public.get_status_page_maintenance(p_org_slug text, p_project_slug text, p_maintenance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_org public.organizations;
  v_maintenance public.maintenances;
begin
  select (x.project).* into v_project from public.status_page_project(p_org_slug, p_project_slug) x;
  if v_project.id is null or not public.status_page_can_read(v_project) then
    return null;
  end if;
  select * into v_org from public.organizations where id = v_project.organization_id;
  select * into v_maintenance from public.maintenances where id = p_maintenance_id and project_id = v_project.id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'slug', v_project.slug, 'organization_slug', v_org.slug,
      'brand_color', v_project.brand_color, 'logo_url', v_project.logo_url, 'theme_default', v_project.theme_default, 'timezone', v_project.timezone,
      'hide_powered_by', v_project.hide_powered_by and public.plan_limit(v_org.plan, 'custom_domain') = 1,
      'custom_domain', case when v_project.custom_domain_status = 'verified' then v_project.custom_domain else null end),
    'maintenance', public.status_page_maintenance_json(v_maintenance)
  );
end;
$$;

create or replace function public.get_status_page_history(p_org_slug text, p_project_slug text, p_before timestamptz default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_org public.organizations;
  v_since timestamptz;
  v_items jsonb;
begin
  select (x.project).* into v_project from public.status_page_project(p_org_slug, p_project_slug) x;
  if v_project.id is null or not public.status_page_can_read(v_project) then
    return null;
  end if;
  select * into v_org from public.organizations where id = v_project.organization_id;
  v_since := now() - make_interval(days => public.plan_limit(v_org.plan, 'history_days'));

  select coalesce(jsonb_agg(item order by (item->>'at')::timestamptz desc), '[]'::jsonb) into v_items
  from (
    select item from (
      select jsonb_build_object('kind', 'incident', 'at', coalesce(i.published_at, i.created_at), 'item', public.status_page_incident_json(i, false)) as item
      from public.incidents i
      where i.project_id = v_project.id and i.deleted_at is null and i.status <> 'draft'
        and coalesce(i.published_at, i.created_at) > v_since
        and (p_before is null or coalesce(i.published_at, i.created_at) < p_before)
      union all
      select jsonb_build_object('kind', 'maintenance', 'at', m.scheduled_start, 'item', public.status_page_maintenance_json(m))
      from public.maintenances m
      where m.project_id = v_project.id and m.status in ('completed', 'cancelled', 'in_progress')
        and m.scheduled_start > v_since and (p_before is null or m.scheduled_start < p_before)
    ) all_items
    order by (item->>'at')::timestamptz desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) limited;

  return jsonb_build_object(
    'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'slug', v_project.slug, 'organization_slug', v_org.slug,
      'brand_color', v_project.brand_color, 'logo_url', v_project.logo_url, 'theme_default', v_project.theme_default, 'timezone', v_project.timezone,
      'hide_powered_by', v_project.hide_powered_by and public.plan_limit(v_org.plan, 'custom_domain') = 1,
      'history_days', public.plan_limit(v_org.plan, 'history_days'),
      'custom_domain', case when v_project.custom_domain_status = 'verified' then v_project.custom_domain else null end),
    'items', v_items
  );
end;
$$;

create or replace function public.resolve_custom_domain(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('organization_slug', o.slug, 'project_slug', p.slug, 'project_id', p.id)
  from public.projects p join public.organizations o on o.id = p.organization_id
  where p.custom_domain = lower(split_part(p_host, ':', 1)) and p.custom_domain_status = 'verified'
  limit 1
$$;

create or replace function public.check_status_page_access(p_project_id uuid, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.status_page_access_tokens set last_used_at = now()
  where project_id = p_project_id and token_hash = p_token_hash and revoked_at is null and (expires_at is null or expires_at > now())
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- ------------------------------------------------------------------
-- API keys v2 (C-1): org or project scope, scopes, expiry, server-side generation only
-- ------------------------------------------------------------------
alter table public.api_keys
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists scopes text[] not null default array['read', 'write']::text[],
  add column if not exists prefix text,
  add column if not exists expires_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.api_keys k set organization_id = p.organization_id
from public.projects p where p.id = k.project_id and k.organization_id is null;
-- Keys whose user does not own the project they point to were created through C-1: revoke them.
update public.api_keys k set revoked_at = now()
where k.revoked_at is null and not exists (
  select 1 from public.projects p join public.organization_members m on m.organization_id = p.organization_id
  where p.id = k.project_id and m.user_id = k.user_id and m.role in ('owner', 'admin')
);
update public.api_keys set prefix = 'pp_live_' where prefix is null;
update public.api_keys set created_by = user_id where created_by is null;
delete from public.api_keys where organization_id is null;

alter table public.api_keys alter column organization_id set not null;
alter table public.api_keys alter column project_id drop not null;
alter table public.api_keys alter column user_id drop not null;
alter table public.api_keys drop constraint if exists api_keys_project_user_unique;
alter table public.api_keys drop constraint if exists api_keys_scopes_check;
alter table public.api_keys add constraint api_keys_scopes_check check (cardinality(scopes) >= 1 and scopes <@ array['read', 'write']::text[]);
create unique index if not exists api_keys_token_hash_key on public.api_keys (token_hash);
create index if not exists api_keys_org_idx on public.api_keys (organization_id);

create or replace function public.api_keys_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (select 1 from public.projects where id = new.project_id and organization_id = new.organization_id) then
    raise exception 'The project belongs to another organization.' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and not public.is_privileged_session() then
    if new.token_hash is distinct from old.token_hash or new.organization_id is distinct from old.organization_id or new.project_id is distinct from old.project_id then
      raise exception 'Create a new key instead of changing this one.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists api_keys_guard on public.api_keys;
create trigger api_keys_guard before insert or update on public.api_keys
for each row execute procedure public.api_keys_guard();

create or replace function public.authenticate_api_key(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key public.api_keys;
  v_org public.organizations;
begin
  select * into v_key from public.api_keys where token_hash = p_token_hash;
  if not found or v_key.revoked_at is not null or (v_key.expires_at is not null and v_key.expires_at <= now()) then
    return null;
  end if;
  select * into v_org from public.organizations where id = v_key.organization_id;
  if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
    update public.api_keys set last_used_at = now() where id = v_key.id;
  end if;
  return jsonb_build_object(
    'id', v_key.id, 'name', v_key.name, 'organization_id', v_key.organization_id, 'organization_slug', v_org.slug,
    'project_id', v_key.project_id, 'scopes', to_jsonb(v_key.scopes), 'plan', v_org.plan, 'prefix', v_key.prefix
  );
end;
$$;

-- ------------------------------------------------------------------
-- Rate limits and idempotency
-- ------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_limit_buckets enable row level security;

create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limit_buckets (bucket, window_start, count) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limit_buckets.count + 1
  returning count into v_count;
  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'limit', p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'reset_at', v_window + make_interval(secs => p_window_seconds)
  );
end;
$$;

create table if not exists public.api_idempotency_keys (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_hash text not null,
  status_code integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (api_key_id, idempotency_key)
);

alter table public.api_idempotency_keys enable row level security;

-- ------------------------------------------------------------------
-- Function privileges
-- ------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.get_status_page(text, text)',
    'public.get_status_page_incident(text, text, uuid)',
    'public.get_status_page_maintenance(text, text, uuid)',
    'public.get_status_page_history(text, text, timestamptz, integer)',
    'public.resolve_custom_domain(text)'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
    execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.status_page_project(text, text)',
    'public.status_page_can_read(public.projects)',
    'public.status_page_incident_json(public.incidents, boolean)',
    'public.status_page_maintenance_json(public.maintenances)',
    'public.check_status_page_access(uuid, text)',
    'public.authenticate_api_key(text)',
    'public.consume_rate_limit(text, integer, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;
