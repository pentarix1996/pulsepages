-- Incident extras: published postmortem in the public incident JSON, actor labels on system rows for API keys
begin;

select tests.as_postgres();
create temporary table t_extras (key text primary key, value text);
insert into t_extras values ('org', (select username from public.profiles where id = tests.alice()));
grant select, insert, update on t_extras to anon, authenticated, service_role;

-- A major incident resolved by alice gets an automatic draft postmortem (projects.auto_postmortem)
select tests.as_user(tests.alice());
do $$
declare
  v_incident public.incidents;
begin
  v_incident := public.create_incident(
    tests.payments(), 'Checkout errors', 'Some checkouts fail.', 'investigating', 'major',
    jsonb_build_object('payments-api', 'partial_outage'), false
  );
  perform public.post_incident_update(v_incident.id, 'resolved', 'Checkouts work again.', 'public', jsonb_build_object('payments-api', 'operational'), false);
  insert into t_extras values ('incident', v_incident.id::text);
  assert exists (select 1 from public.postmortems where incident_id = v_incident.id and status = 'draft'), 'draft postmortem created on resolve';
end $$;

-- Drafts stay private: postmortem is null, every existing key is still there
select tests.as_anon();
do $$
declare
  v_json jsonb := public.get_status_page_incident((select value from t_extras where key = 'org'), 'payments', (select value::uuid from t_extras where key = 'incident'));
  v_incident jsonb := v_json -> 'incident';
  v_key text;
begin
  assert v_json is not null, 'resolved incident visible on the public page';
  foreach v_key in array array['id', 'title', 'status', 'impact', 'started_at', 'resolved_at', 'updated_at', 'components', 'updates', 'postmortem'] loop
    assert v_incident ? v_key, format('key %s present', v_key);
  end loop;
  assert jsonb_typeof(v_incident -> 'postmortem') = 'null', 'draft postmortem is not public';
  assert jsonb_array_length(v_incident -> 'updates') = 2, 'public updates unchanged';
end $$;

-- Publishing exposes the sections and only the title and state of action items
select tests.as_user(tests.alice());
do $$
begin
  update public.postmortems
  set status = 'published', published_at = now(),
      title = 'Postmortem: checkout errors', summary = 'Checkouts failed for 12 minutes.', impact = '4% of checkouts failed.',
      root_cause = 'A connection pool was too small.', resolution = 'We raised the pool size.', lessons = 'Alert on pool usage.',
      action_items = '[
        {"id": "a1", "title": "Alert on pool usage", "owner": "Alice", "done": true, "due_date": "2026-11-01", "url": "https://tracker.example.com/1"},
        {"id": "a2", "title": "Load test checkout", "owner": "Bob", "done": false},
        {"id": "a3", "title": "   ", "done": true},
        "not an object",
        {"id": "a4", "title": "Write runbook", "done": "yes"}
      ]'::jsonb
  where incident_id = (select value::uuid from t_extras where key = 'incident');
end $$;

select tests.as_anon();
do $$
declare
  v_pm jsonb := public.get_status_page_incident((select value from t_extras where key = 'org'), 'payments', (select value::uuid from t_extras where key = 'incident')) -> 'incident' -> 'postmortem';
begin
  assert jsonb_typeof(v_pm) = 'object', 'published postmortem is public';
  assert v_pm ->> 'title' = 'Postmortem: checkout errors';
  assert v_pm ->> 'summary' = 'Checkouts failed for 12 minutes.';
  assert v_pm ->> 'impact' = '4% of checkouts failed.';
  assert v_pm ->> 'root_cause' = 'A connection pool was too small.';
  assert v_pm ->> 'resolution' = 'We raised the pool size.';
  assert v_pm ->> 'lessons' = 'Alert on pool usage.';
  assert v_pm ->> 'published_at' is not null;
  assert v_pm -> 'action_items' = '[
    {"title": "Alert on pool usage", "done": true},
    {"title": "Load test checkout", "done": false},
    {"title": "Write runbook", "done": false}
  ]'::jsonb, format('public action items: %s', v_pm -> 'action_items');
  assert v_pm::text not like '%Alice%' and v_pm::text not like '%tracker.example.com%', 'owners and links stay internal';
end $$;

-- The history and the main page use the same JSON
select tests.as_anon();
do $$
declare
  v_history jsonb := public.get_status_page_history((select value from t_extras where key = 'org'), 'payments', null, 50);
begin
  assert exists (
    select 1 from jsonb_array_elements(v_history -> 'items') item
    where item -> 'item' ->> 'id' = (select value from t_extras where key = 'incident') and item -> 'item' -> 'postmortem' ->> 'title' = 'Postmortem: checkout errors'
  ), format('history carries the postmortem: %s', v_history);
end $$;

-- Unpublishing hides it again
select tests.as_user(tests.alice());
update public.postmortems set status = 'draft', published_at = null where incident_id = (select value::uuid from t_extras where key = 'incident');
select tests.as_anon();
do $$
begin
  assert jsonb_typeof(public.get_status_page_incident((select value from t_extras where key = 'org'), 'payments', (select value::uuid from t_extras where key = 'incident')) -> 'incident' -> 'postmortem') = 'null';
end $$;

-- API keys: system rows written by triggers carry the key's label
select tests.as_user(tests.alice());
do $$
declare
  v_incident public.incidents;
begin
  v_incident := public.create_incident(tests.payments(), 'Webhooks slow', 'Deliveries are late.', 'investigating', 'minor', '{}'::jsonb, false, 'api', 'API key CI');
  insert into t_extras values ('api_incident', v_incident.id::text);
end $$;

select tests.as_api_key('api_key:ci');
do $$
declare
  v_id uuid := (select value::uuid from t_extras where key = 'api_incident');
  v_incident public.incidents;
begin
  v_incident := public.acknowledge_incident(v_id, 'API key CI');
  assert v_incident.acknowledged_at is not null and v_incident.acknowledged_by is null;
  assert exists (
    select 1 from public.incident_updates
    where incident_id = v_id and kind = 'system' and message = 'Acknowledged by API key CI.' and actor_label = 'API key CI' and created_by is null
  ), 'acknowledgement attributed to the key';

  perform public.update_incident_details(v_id, 'Webhooks slow in EU', 'major', 'API key CI');
  assert exists (
    select 1 from public.incident_updates
    where incident_id = v_id and kind = 'system' and message like 'Title changed%Impact changed from minor to major.' and actor_label = 'API key CI'
  ), 'detail changes attributed to the key';

  -- The label does not leak into later writes of the same transaction
  update public.incidents set impact = 'critical' where id = v_id;
  assert (select actor_label from public.incident_updates where incident_id = v_id and message = 'Impact changed from major to critical.') is null, 'label reset after the call';

  perform public.delete_incident(v_id, 'API key CI');
  assert exists (select 1 from public.incident_updates where incident_id = v_id and message = 'Incident deleted.' and actor_label = 'API key CI');
end $$;

-- Dashboard users: the label is ignored, the user is recorded by id; old call shapes keep working
select tests.as_user(tests.alice());
do $$
declare
  v_incident public.incidents;
begin
  v_incident := public.create_incident(tests.payments(), 'Login errors', 'Some logins fail.', 'investigating', 'minor', '{}'::jsonb, false);
  v_incident := public.acknowledge_incident(v_incident.id);
  assert v_incident.acknowledged_by = tests.alice();
  assert exists (
    select 1 from public.incident_updates
    where incident_id = v_incident.id and kind = 'system' and message = 'Acknowledged by Alice Admin.' and created_by = tests.alice() and actor_label is null
  ), 'user acknowledgement';
  perform public.update_incident_details(v_incident.id, 'Login errors in EU');
  assert (select title from public.incidents where id = v_incident.id) = 'Login errors in EU';
  perform public.delete_incident(v_incident.id);
  assert (select deleted_at from public.incidents where id = v_incident.id) is not null;
  -- The three-argument signature was replaced, not overloaded
  assert to_regprocedure('public.update_incident_details(uuid, text, text)') is null;
  assert to_regprocedure('public.acknowledge_incident(uuid)') is null;
  assert to_regprocedure('public.delete_incident(uuid)') is null;
end $$;

-- Strangers still cannot acknowledge someone else's incident
select tests.as_user(tests.mallory());
do $$
begin
  begin
    perform public.acknowledge_incident('00000000-0000-0000-0000-00000000e001', 'Mallory');
    raise exception 'stranger acknowledged an incident';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anonymous visitors cannot call the incident RPCs at all
select tests.as_anon();
do $$
begin
  begin
    perform public.acknowledge_incident('00000000-0000-0000-0000-00000000e001');
    raise exception 'anon acknowledged an incident';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
