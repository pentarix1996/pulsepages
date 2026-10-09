-- Security invariants over the whole schema, so a new migration cannot quietly break them:
--   1. every table in public has row level security enabled;
--   2. SECURITY DEFINER functions pin search_path;
--   3. only an explicit allow-list of SECURITY DEFINER functions is callable by anon / authenticated
--      (everything else is service_role only: revoke ... from public, anon, authenticated).
-- Trigger functions are skipped in 3: they cannot be called directly.
begin;

select tests.as_postgres();

do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'Tables without row level security: %', v_missing;
  end if;
end $$;

do $$
declare
  v_unpinned text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_unpinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) as setting where setting like 'search_path=%');
  if v_unpinned is not null then
    raise exception 'SECURITY DEFINER functions without a fixed search_path: %', v_unpinned;
  end if;
end $$;

do $$
declare
  -- Public status page reads and role checks used inside RLS policies.
  v_anon_allowed text[] := array[
    'get_status_page', 'get_status_page_history', 'get_status_page_history_newer', 'get_status_page_incident',
    'get_status_page_maintenance', 'resolve_custom_domain', 'has_org_role', 'has_project_role', 'org_role'
  ];
  -- Dashboard RPCs: each one checks the caller's role itself.
  v_authenticated_allowed text[] := v_anon_allowed || array[
    'accept_invitation', 'acknowledge_incident', 'assert_project_role', 'create_incident', 'create_maintenance',
    'create_organization', 'delete_incident', 'email_belongs_to_channel_member', 'ensure_postmortem_draft',
    'get_project_latency', 'get_project_metrics', 'get_project_slos', 'get_project_uptime', 'incident_component_snapshot',
    'member_organization_ids', 'member_project_ids', 'organization_member_list', 'organization_usage',
    'post_incident_update', 'post_maintenance_update', 'reset_user_data', 'set_component_manual_status',
    'set_maintenance_status', 'update_incident_details', 'update_maintenance'
  ];
  v_unexpected text;
begin
  select string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ' order by p.proname) into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> all (v_anon_allowed);
  if v_unexpected is not null then
    raise exception 'SECURITY DEFINER functions callable by anon that are not on the allow-list: %', v_unexpected;
  end if;

  select string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ' order by p.proname) into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname <> all (v_authenticated_allowed);
  if v_unexpected is not null then
    raise exception 'SECURITY DEFINER functions callable by authenticated users that are not on the allow-list: %', v_unexpected;
  end if;
end $$;

-- Service-only functions that handle secrets or bypass membership checks stay out of reach.
do $$
declare
  v_name text;
begin
  foreach v_name in array array['finalize_alert_event', 'verify_alert_recipient', 'subscribe_to_status_page', 'check_status_page_access'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    ) then
      raise exception '% must be callable by service_role only', v_name;
    end if;
  end loop;
end $$;

rollback;
