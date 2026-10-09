-- ==========================================
-- Migration: v2 incident extras
-- ==========================================
-- 1. Public incident JSON carries the published postmortem (title, sections and public action items) so the status
--    page can render it under the incident permalink.
-- 2. Changes made by API keys through update_incident_details, acknowledge_incident and delete_incident are logged
--    with the key's label: the system rows written by incidents_after_update used to read "Upvane" for them.
-- Idempotent: safe to apply more than once.

-- ------------------------------------------------------------------
-- 1. Published postmortem in the public incident JSON
-- ------------------------------------------------------------------
-- `postmortem` is null unless the incident's postmortem is published. Action items expose only their title and
-- whether they are done (owners and due dates stay internal). Every other key is unchanged.
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
      select jsonb_build_object(
        'title', pm.title,
        'summary', pm.summary,
        'impact', pm.impact,
        'root_cause', pm.root_cause,
        'resolution', pm.resolution,
        'lessons', pm.lessons,
        'action_items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'title', item.value ->> 'title',
              'done', case when jsonb_typeof(item.value -> 'done') = 'boolean' then (item.value -> 'done')::boolean else false end
            ) order by item.ordinality
          )
          from jsonb_array_elements(case when jsonb_typeof(pm.action_items) = 'array' then pm.action_items else '[]'::jsonb end)
            with ordinality as item(value, ordinality)
          where jsonb_typeof(item.value) = 'object' and coalesce(btrim(item.value ->> 'title'), '') <> ''
        ), '[]'::jsonb),
        'published_at', pm.published_at
      )
      from public.postmortems pm
      where pm.incident_id = p_incident.id and pm.status = 'published'
    )
  )
$$;

-- ------------------------------------------------------------------
-- 2. Actor labels on trigger-written system rows
-- ------------------------------------------------------------------
-- The RPCs below put the caller's label (API keys) in the transaction-local setting `upvane.actor_label` around
-- their write; incidents_after_update copies it to the system row when there is no signed-in user.
create or replace function public.incidents_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component uuid;
  v_reason text;
  v_messages text[] := '{}';
  v_label text := nullif(current_setting('upvane.actor_label', true), '');
begin
  if new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at then
    v_reason := case when new.status = 'resolved' or new.deleted_at is not null then 'incident_resolved' else 'incident' end;
    for v_component in select component_id from public.incident_components where incident_id = new.id loop
      perform public.recompute_component_status(v_component, v_reason, new.id);
    end loop;
  end if;

  if new.title is distinct from old.title then
    v_messages := v_messages || format('Title changed from "%s" to "%s".', old.title, new.title);
  end if;
  if new.impact is distinct from old.impact then
    v_messages := v_messages || format('Impact changed from %s to %s.', old.impact, new.impact);
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    v_messages := v_messages || 'Incident deleted.'::text;
  end if;
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    v_messages := v_messages || coalesce(
      'Acknowledged by ' || (select coalesce(nullif(p.name, ''), p.username) from public.profiles p where p.id = new.acknowledged_by) || '.',
      'Acknowledged by ' || v_label || '.',
      'Acknowledged.'
    );
  end if;
  if array_length(v_messages, 1) > 0 then
    insert into public.incident_updates (incident_id, kind, visibility, status, message, created_by, actor_label)
    values (new.id, 'system', 'internal', new.status, array_to_string(v_messages, ' '), auth.uid(), case when auth.uid() is null then v_label end);
  end if;
  return null;
end;
$$;

-- New signatures add `p_actor_label` with a default, so existing calls (named or positional) keep working.
drop function if exists public.update_incident_details(uuid, text, text);
create or replace function public.update_incident_details(
  p_incident_id uuid,
  p_title text default null,
  p_impact text default null,
  p_actor_label text default null
)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_incident.project_id, 'responder');
  if p_impact is not null and p_impact not in ('none', 'minor', 'major', 'critical') then
    raise exception 'Invalid incident impact %.', p_impact using errcode = '22023';
  end if;
  if p_title is not null and (char_length(trim(p_title)) = 0 or char_length(p_title) > 200) then
    raise exception 'Give the incident a title of up to 200 characters.' using errcode = '22023';
  end if;
  perform set_config('upvane.actor_label', coalesce(p_actor_label, ''), true);
  update public.incidents
  set title = coalesce(nullif(trim(p_title), ''), title), impact = coalesce(p_impact, impact)
  where id = p_incident_id
  returning * into v_incident;
  perform set_config('upvane.actor_label', '', true);
  return v_incident;
end;
$$;

drop function if exists public.acknowledge_incident(uuid);
create or replace function public.acknowledge_incident(p_incident_id uuid, p_actor_label text default null)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_incident.project_id, 'responder');
  if v_incident.acknowledged_at is null then
    perform set_config('upvane.actor_label', coalesce(p_actor_label, ''), true);
    update public.incidents set acknowledged_at = now(), acknowledged_by = auth.uid() where id = p_incident_id returning * into v_incident;
    perform set_config('upvane.actor_label', '', true);
  end if;
  return v_incident;
end;
$$;

drop function if exists public.delete_incident(uuid);
create or replace function public.delete_incident(p_incident_id uuid, p_actor_label text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id and deleted_at is null for update;
  if not found then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  perform public.assert_project_role(v_incident.project_id, 'admin');
  perform set_config('upvane.actor_label', coalesce(p_actor_label, ''), true);
  update public.incidents set deleted_at = now() where id = p_incident_id;
  perform set_config('upvane.actor_label', '', true);
end;
$$;

-- ------------------------------------------------------------------
-- Function privileges (Postgres grants EXECUTE to PUBLIC on new functions)
-- ------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.update_incident_details(uuid, text, text, text)',
    'public.acknowledge_incident(uuid, text)',
    'public.delete_incident(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;

  execute 'revoke execute on function public.status_page_incident_json(public.incidents, boolean) from public, anon, authenticated';
  execute 'grant execute on function public.status_page_incident_json(public.incidents, boolean) to service_role';
end $$;

notify pgrst, 'reload schema';
