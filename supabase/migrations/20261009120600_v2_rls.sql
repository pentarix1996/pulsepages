-- ==========================================
-- Migration: v2 row level security
-- ==========================================
-- Every policy created before v2 is dropped (including any unversioned production policy) and replaced by
-- organization-membership policies. Anonymous visitors read status pages only through get_status_page() (M-10).
-- Writes that need validation or side effects go through security definer RPCs; tables without a write policy
-- are read-only for clients.

create or replace function public.member_project_ids(p_min_role text default 'viewer')
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.projects p
  join public.organization_members m on m.organization_id = p.organization_id
  where m.user_id = auth.uid() and public.org_role_rank(m.role) >= public.org_role_rank(p_min_role)
$$;

create or replace function public.member_organization_ids(p_min_role text default 'viewer')
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id from public.organization_members m
  where m.user_id = auth.uid() and public.org_role_rank(m.role) >= public.org_role_rank(p_min_role)
$$;

revoke execute on function public.member_project_ids(text) from public, anon;
grant execute on function public.member_project_ids(text) to authenticated, service_role;
revoke execute on function public.member_organization_ids(text) from public, anon;
grant execute on function public.member_organization_ids(text) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Drop every existing policy on the tables we manage
-- ------------------------------------------------------------------
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in (
      'profiles', 'organizations', 'organization_members', 'organization_invitations', 'audit_logs',
      'projects', 'components', 'component_groups', 'component_dependencies', 'component_status_history',
      'incidents', 'incident_components', 'incident_updates', 'incident_templates', 'postmortems',
      'maintenances', 'maintenance_components', 'maintenance_updates',
      'monitors', 'monitor_components', 'monitor_secrets', 'monitor_region_state', 'monitor_check_results', 'component_monitor_configs',
      'inbound_integrations', 'component_signals',
      'alert_channels', 'alert_channel_secrets', 'alert_email_recipients', 'alert_rules', 'alert_rule_cooldowns', 'alert_worker_wakeups',
      'project_alert_configs', 'alert_channel_configs', 'alert_events', 'alert_deliveries', 'alert_cooldowns',
      'status_page_subscribers', 'status_page_access_tokens', 'slos',
      'api_keys', 'rate_limit_buckets', 'api_idempotency_keys'
    )
  loop
    execute format('drop policy %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end $$;

-- RLS on for every table (some legacy tables already had it).
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.components enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_updates enable row level security;
alter table public.component_status_history enable row level security;
alter table public.api_keys enable row level security;
alter table public.component_monitor_configs enable row level security;
alter table public.monitor_check_results enable row level security;
alter table public.project_alert_configs enable row level security;
alter table public.alert_channel_configs enable row level security;
alter table public.alert_events enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.alert_cooldowns enable row level security;

-- ------------------------------------------------------------------
-- Accounts and organizations
-- ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid() or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
using (id in (select public.member_organization_ids('viewer')));
create policy organizations_update on public.organizations for update to authenticated
using (id in (select public.member_organization_ids('admin')))
with check (id in (select public.member_organization_ids('admin')));
create policy organizations_delete on public.organizations for delete to authenticated
using (not personal and id in (select public.member_organization_ids('owner')));

create policy organization_members_select on public.organization_members for select to authenticated
using (organization_id in (select public.member_organization_ids('viewer')));
create policy organization_members_update on public.organization_members for update to authenticated
using (organization_id in (select public.member_organization_ids('admin')))
with check (organization_id in (select public.member_organization_ids('admin')));
create policy organization_members_delete on public.organization_members for delete to authenticated
using (user_id = auth.uid() or organization_id in (select public.member_organization_ids('admin')));

create policy organization_invitations_select on public.organization_invitations for select to authenticated
using (organization_id in (select public.member_organization_ids('admin')));
create policy organization_invitations_insert on public.organization_invitations for insert to authenticated
with check (
  organization_id in (select public.member_organization_ids('admin'))
  and (role <> 'owner' or organization_id in (select public.member_organization_ids('owner')))
  and invited_by = auth.uid()
);
create policy organization_invitations_update on public.organization_invitations for update to authenticated
using (organization_id in (select public.member_organization_ids('admin')))
with check (organization_id in (select public.member_organization_ids('admin')) and (role <> 'owner' or organization_id in (select public.member_organization_ids('owner'))));
create policy organization_invitations_delete on public.organization_invitations for delete to authenticated
using (organization_id in (select public.member_organization_ids('admin')));

create policy audit_logs_select on public.audit_logs for select to authenticated
using (organization_id in (select public.member_organization_ids('admin')));

-- ------------------------------------------------------------------
-- Projects and components
-- ------------------------------------------------------------------
create policy projects_select on public.projects for select to authenticated
using (id in (select public.member_project_ids('viewer')));
create policy projects_insert on public.projects for insert to authenticated
with check (organization_id in (select public.member_organization_ids('admin')));
create policy projects_update on public.projects for update to authenticated
using (id in (select public.member_project_ids('admin')))
with check (organization_id in (select public.member_organization_ids('admin')));
create policy projects_delete on public.projects for delete to authenticated
using (id in (select public.member_project_ids('admin')));

create policy components_select on public.components for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy components_insert on public.components for insert to authenticated
with check (project_id in (select public.member_project_ids('admin')));
create policy components_update on public.components for update to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));
create policy components_delete on public.components for delete to authenticated
using (project_id in (select public.member_project_ids('admin')));

create policy component_groups_select on public.component_groups for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy component_groups_write on public.component_groups for all to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));

create policy component_dependencies_select on public.component_dependencies for select to authenticated
using (exists (select 1 from public.components c where c.id = component_dependencies.component_id and c.project_id in (select public.member_project_ids('viewer'))));
create policy component_dependencies_write on public.component_dependencies for all to authenticated
using (exists (select 1 from public.components c where c.id = component_dependencies.component_id and c.project_id in (select public.member_project_ids('admin'))))
with check (exists (select 1 from public.components c where c.id = component_dependencies.component_id and c.project_id in (select public.member_project_ids('admin'))));

create policy component_status_history_select on public.component_status_history for select to authenticated
using (exists (select 1 from public.components c where c.id = component_status_history.component_id and c.project_id in (select public.member_project_ids('viewer'))));

create policy slos_select on public.slos for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy slos_write on public.slos for all to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));

-- ------------------------------------------------------------------
-- Incidents, maintenance (writes through RPCs)
-- ------------------------------------------------------------------
create policy incidents_select on public.incidents for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));

create policy incident_components_select on public.incident_components for select to authenticated
using (exists (select 1 from public.incidents i where i.id = incident_components.incident_id and i.project_id in (select public.member_project_ids('viewer'))));

create policy incident_updates_select on public.incident_updates for select to authenticated
using (exists (select 1 from public.incidents i where i.id = incident_updates.incident_id and i.project_id in (select public.member_project_ids('viewer'))));

create policy incident_templates_select on public.incident_templates for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy incident_templates_write on public.incident_templates for all to authenticated
using (project_id in (select public.member_project_ids('responder')))
with check (project_id in (select public.member_project_ids('responder')));

create policy postmortems_select on public.postmortems for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy postmortems_insert on public.postmortems for insert to authenticated
with check (project_id in (select public.member_project_ids('responder')));
create policy postmortems_update on public.postmortems for update to authenticated
using (project_id in (select public.member_project_ids('responder')))
with check (project_id in (select public.member_project_ids('responder')));
create policy postmortems_delete on public.postmortems for delete to authenticated
using (project_id in (select public.member_project_ids('admin')));

create policy maintenances_select on public.maintenances for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy maintenance_components_select on public.maintenance_components for select to authenticated
using (exists (select 1 from public.maintenances m where m.id = maintenance_components.maintenance_id and m.project_id in (select public.member_project_ids('viewer'))));
create policy maintenance_updates_select on public.maintenance_updates for select to authenticated
using (exists (select 1 from public.maintenances m where m.id = maintenance_updates.maintenance_id and m.project_id in (select public.member_project_ids('viewer'))));

-- ------------------------------------------------------------------
-- Monitors and signals
-- ------------------------------------------------------------------
create policy monitors_select on public.monitors for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy monitors_insert on public.monitors for insert to authenticated
with check (project_id in (select public.member_project_ids('admin')));
create policy monitors_update on public.monitors for update to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));
create policy monitors_delete on public.monitors for delete to authenticated
using (project_id in (select public.member_project_ids('admin')));

create policy monitor_components_select on public.monitor_components for select to authenticated
using (exists (select 1 from public.monitors m where m.id = monitor_components.monitor_id and m.project_id in (select public.member_project_ids('viewer'))));
create policy monitor_components_write on public.monitor_components for all to authenticated
using (exists (select 1 from public.monitors m where m.id = monitor_components.monitor_id and m.project_id in (select public.member_project_ids('admin'))))
with check (exists (select 1 from public.monitors m where m.id = monitor_components.monitor_id and m.project_id in (select public.member_project_ids('admin'))));

create policy monitor_region_state_select on public.monitor_region_state for select to authenticated
using (exists (select 1 from public.monitors m where m.id = monitor_region_state.monitor_id and m.project_id in (select public.member_project_ids('viewer'))));

create policy monitor_check_results_select on public.monitor_check_results for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));

create policy component_monitor_configs_select on public.component_monitor_configs for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));

create policy inbound_integrations_select on public.inbound_integrations for select to authenticated
using (project_id in (select public.member_project_ids('admin')));
create policy inbound_integrations_write on public.inbound_integrations for all to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));

create policy component_signals_select on public.component_signals for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));

-- ------------------------------------------------------------------
-- Alerts
-- ------------------------------------------------------------------
create policy project_alert_configs_select on public.project_alert_configs for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy project_alert_configs_write on public.project_alert_configs for all to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));

create policy alert_channels_select on public.alert_channels for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy alert_channels_write on public.alert_channels for all to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));

create policy alert_email_recipients_select on public.alert_email_recipients for select to authenticated
using (exists (select 1 from public.alert_channels ch where ch.id = alert_email_recipients.channel_id and ch.project_id in (select public.member_project_ids('viewer'))));
create policy alert_email_recipients_insert on public.alert_email_recipients for insert to authenticated
with check (exists (select 1 from public.alert_channels ch where ch.id = alert_email_recipients.channel_id and ch.project_id in (select public.member_project_ids('admin'))));
create policy alert_email_recipients_delete on public.alert_email_recipients for delete to authenticated
using (exists (select 1 from public.alert_channels ch where ch.id = alert_email_recipients.channel_id and ch.project_id in (select public.member_project_ids('admin'))));

create policy alert_rules_select on public.alert_rules for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));
create policy alert_rules_write on public.alert_rules for all to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));

create policy alert_channel_configs_select on public.alert_channel_configs for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));

create policy alert_events_select on public.alert_events for select to authenticated
using (project_id in (select public.member_project_ids('viewer')));

create policy alert_deliveries_select on public.alert_deliveries for select to authenticated
using (exists (select 1 from public.alert_events e where e.id = alert_deliveries.event_id and e.project_id in (select public.member_project_ids('viewer'))));

-- Recipients added from the dashboard start unverified unless they belong to a member of the organization (A-8).
create or replace function public.email_belongs_to_channel_member(p_channel_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.alert_channels ch
    join public.projects p on p.id = ch.project_id
    join public.organization_members m on m.organization_id = p.organization_id
    join auth.users u on u.id = m.user_id
    where ch.id = p_channel_id and lower(u.email) = lower(p_email)
  )
$$;

revoke execute on function public.email_belongs_to_channel_member(uuid, text) from public, anon;
grant execute on function public.email_belongs_to_channel_member(uuid, text) to authenticated, service_role;

-- Runs as the caller so is_privileged_session() can tell dashboard writes from server writes.
create or replace function public.alert_email_recipients_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  if not public.is_privileged_session() then
    if tg_op = 'UPDATE' then
      new.verified_at := old.verified_at;
      new.token_hash := old.token_hash;
    else
      new.verified_at := case when public.email_belongs_to_channel_member(new.channel_id, new.email) then now() else null end;
      new.token_hash := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists alert_email_recipients_guard on public.alert_email_recipients;
create trigger alert_email_recipients_guard before insert or update on public.alert_email_recipients
for each row execute procedure public.alert_email_recipients_guard();

-- ------------------------------------------------------------------
-- Status page subscribers and access tokens
-- ------------------------------------------------------------------
create policy status_page_subscribers_select on public.status_page_subscribers for select to authenticated
using (project_id in (select public.member_project_ids('admin')));
create policy status_page_subscribers_delete on public.status_page_subscribers for delete to authenticated
using (project_id in (select public.member_project_ids('admin')));

create policy status_page_access_tokens_select on public.status_page_access_tokens for select to authenticated
using (project_id in (select public.member_project_ids('admin')));
create policy status_page_access_tokens_insert on public.status_page_access_tokens for insert to authenticated
with check (project_id in (select public.member_project_ids('admin')) and created_by = auth.uid());
create policy status_page_access_tokens_update on public.status_page_access_tokens for update to authenticated
using (project_id in (select public.member_project_ids('admin')))
with check (project_id in (select public.member_project_ids('admin')));
create policy status_page_access_tokens_delete on public.status_page_access_tokens for delete to authenticated
using (project_id in (select public.member_project_ids('admin')));

-- ------------------------------------------------------------------
-- API keys (C-1): readable and revocable by admins; created only by the server with service_role
-- ------------------------------------------------------------------
create policy api_keys_select on public.api_keys for select to authenticated
using (organization_id in (select public.member_organization_ids('admin')));
create policy api_keys_update on public.api_keys for update to authenticated
using (organization_id in (select public.member_organization_ids('admin')))
with check (organization_id in (select public.member_organization_ids('admin')));
create policy api_keys_delete on public.api_keys for delete to authenticated
using (organization_id in (select public.member_organization_ids('admin')));

-- Anonymous visitors have no direct table access at all.
do $$
declare
  v_table text;
begin
  for v_table in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon', v_table);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- Storage: logos for branded status pages
-- ------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists branding_read on storage.objects';
    execute 'drop policy if exists branding_write on storage.objects';
    execute $p$create policy branding_read on storage.objects for select using (bucket_id = 'branding')$p$;
    execute $p$create policy branding_write on storage.objects for all to authenticated
      using (bucket_id = 'branding' and public.safe_uuid((storage.foldername(name))[1]) in (select public.member_project_ids('admin')))
      with check (bucket_id = 'branding' and public.safe_uuid((storage.foldername(name))[1]) in (select public.member_project_ids('admin')))$p$;
  end if;
end $$;
