-- ==========================================
-- Migration: v2 status page extras
-- ==========================================
-- Helpers for the public status page that the main payload (get_status_page) deliberately leaves out:
--   * status_page_access_info(project_id): private-page facts (allow-listed IP ranges, SSO domain) and the link data
--     the confirmation and unsubscribe pages need. Service role only; never reaches the browser.
--   * get_status_page_history_newer(org, slug, after, limit): the page of history right after a cursor, so the
--     history page can paginate towards the present ("Newer") as well as into the past (get_status_page_history).
--   * get_status_page_subscription(unsubscribe_token_hash): which subscription an unsubscribe link ends, so the page
--     can name it before the visitor confirms. Service role only.

create or replace function public.status_page_access_info(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'slug', p.slug,
    'visibility', p.visibility,
    'organization_slug', o.slug,
    'organization_name', o.name,
    'sso_domain', o.sso_domain,
    'allowed_ips', to_jsonb(coalesce(p.allowed_ips, '{}'::text[])),
    'custom_domain', case when p.custom_domain_status = 'verified' then p.custom_domain else null end,
    'brand_color', p.brand_color,
    'logo_url', p.logo_url,
    'theme_default', p.theme_default,
    'timezone', p.timezone
  )
  from public.projects p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_project_id
$$;

-- Same items, filters and access rules as get_status_page_history, but returns the p_limit items immediately newer
-- than p_after (strictly), newest first.
create or replace function public.get_status_page_history_newer(p_org_slug text, p_project_slug text, p_after timestamptz, p_limit integer default 20)
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
  if p_after is null then
    raise exception 'A cursor is required.' using errcode = '22023';
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
        and coalesce(i.published_at, i.created_at) > p_after
      union all
      select jsonb_build_object('kind', 'maintenance', 'at', m.scheduled_start, 'item', public.status_page_maintenance_json(m))
      from public.maintenances m
      where m.project_id = v_project.id and m.status in ('completed', 'cancelled', 'in_progress')
        and m.scheduled_start > v_since and m.scheduled_start > p_after
    ) all_items
    order by (item->>'at')::timestamptz asc
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

create or replace function public.get_status_page_subscription(p_unsubscribe_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'project_id', s.project_id,
    'type', s.type,
    'email', s.email,
    'target_hint', s.target_hint,
    'confirmed', s.confirmed_at is not null
  )
  from public.status_page_subscribers s
  where s.unsubscribe_token_hash = p_unsubscribe_token_hash
$$;

-- ------------------------------------------------------------------
-- Function privileges (execute is granted to PUBLIC by default)
-- ------------------------------------------------------------------
revoke execute on function public.get_status_page_history_newer(text, text, timestamptz, integer) from public;
grant execute on function public.get_status_page_history_newer(text, text, timestamptz, integer) to anon, authenticated, service_role;

revoke execute on function public.status_page_access_info(uuid) from public, anon, authenticated;
grant execute on function public.status_page_access_info(uuid) to service_role;

revoke execute on function public.get_status_page_subscription(text) from public, anon, authenticated;
grant execute on function public.get_status_page_subscription(text) to service_role;
