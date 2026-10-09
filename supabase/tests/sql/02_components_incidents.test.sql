-- Component status computation, incidents and maintenance (M-5)
begin;

do $$
begin
  -- Invalid legacy status normalized, slugs created, created_at backfilled before the history
  assert (select status from public.components where name = 'Web') = 'operational', 'invalid status normalized';
  assert (select slug from public.components where id = tests.payments_api()) = 'payments-api', 'slug from name';
  assert (select created_at from public.components where id = tests.payments_api()) <= now() - interval '59 days', 'created_at backfilled from project';
  -- Legacy active incident → explicit per-component status, still owning the component
  assert (select status from public.incident_components where incident_id = '00000000-0000-0000-0000-00000000e001' and component_id = tests.payments_api()) = 'partial_outage';
  assert (select status from public.components where id = tests.payments_api()) = 'partial_outage';
  assert (select status_source from public.components where id = tests.payments_api()) = 'incident';
  -- Legacy maintenance incident became resolved, impact mapped from severity
  assert (select status from public.incidents where id = '00000000-0000-0000-0000-00000000e003') = 'resolved';
  assert (select impact from public.incidents where id = '00000000-0000-0000-0000-00000000e001') = 'major';
  assert (select resolved_at from public.incidents where id = '00000000-0000-0000-0000-00000000e002') is not null;
end $$;

select tests.as_user(tests.alice());

-- Direct status writes from the dashboard become a manual pin
do $$
begin
  update public.components set status = 'degraded' where id = tests.webhooks();
  assert (select manual_status from public.components where id = tests.webhooks()) = 'degraded', 'pinned';
  assert (select status from public.components where id = tests.webhooks()) = 'degraded', 'effective status follows pin';
  assert (select reason from public.component_status_history where component_id = tests.webhooks() order by changed_at desc limit 1) = 'manual';
end $$;

-- Incidents set component statuses explicitly; resolving returns to the pin, not to operational
do $$
declare
  v_incident public.incidents;
  v_update public.incident_updates;
begin
  v_incident := public.create_incident(
    tests.payments(), 'Webhooks delayed', 'Deliveries are late.', 'investigating', 'minor',
    jsonb_build_object('webhooks', 'major_outage'), true, 'manual', 'Alice'
  );
  assert (select status from public.components where id = tests.webhooks()) = 'major_outage', 'incident owns component';
  assert v_incident.published_at is not null and v_incident.severity = 'medium';
  assert (select count(*) from public.incident_updates where incident_id = v_incident.id and visibility = 'public') = 1;

  -- Internal notes do not change anything
  v_update := public.post_incident_update(v_incident.id, null, 'Looking at queue depth.', 'internal');
  assert v_update.kind = 'note' and v_update.visibility = 'internal';

  -- A public update can lower one component and keep the incident open
  v_update := public.post_incident_update(v_incident.id, 'monitoring', 'Queue draining.', 'public', jsonb_build_object(tests.webhooks()::text, 'degraded'));
  assert (select status from public.components where id = tests.webhooks()) = 'degraded';
  assert v_update.component_statuses ->> tests.webhooks()::text = 'degraded';

  -- Title and impact changes are logged
  perform public.update_incident_details(v_incident.id, 'Webhooks delayed in EU', 'major');
  assert exists (select 1 from public.incident_updates where incident_id = v_incident.id and kind = 'system' and message like 'Title changed%');

  v_update := public.post_incident_update(v_incident.id, 'resolved', 'All caught up.', 'public', jsonb_build_object(tests.webhooks()::text, 'operational'));
  assert (select resolved_at from public.incidents where id = v_incident.id) is not null;
  assert (select status from public.components where id = tests.webhooks()) = 'degraded', 'manual pin applies again after resolve';
  assert exists (select 1 from public.postmortems where incident_id = v_incident.id), 'major incident gets a postmortem draft';

  -- Reopening reapplies the incident status
  v_update := public.post_incident_update(v_incident.id, 'identified', 'It is back.', 'public', jsonb_build_object(tests.webhooks()::text, 'partial_outage'));
  assert (select status from public.components where id = tests.webhooks()) = 'partial_outage';
  assert (select resolved_at from public.incidents where id = v_incident.id) is null;

  -- Clearing the pin returns the component to automation (none) once the incident is gone
  perform public.set_component_manual_status(tests.webhooks(), null);
  perform public.delete_incident(v_incident.id);
  assert (select status from public.components where id = tests.webhooks()) = 'operational', 'soft delete recomputes';
  assert exists (select 1 from public.incidents where id = v_incident.id and deleted_at is not null);
end $$;

-- Drafts never change public status
do $$
declare
  v_incident public.incidents;
begin
  v_incident := public.create_incident(tests.payments(), 'Draft', null, 'draft', 'minor', jsonb_build_object('api-gateway', 'major_outage'));
  assert (select status from public.components where id = tests.gateway()) = 'operational';
  perform public.post_incident_update(v_incident.id, 'investigating', 'Publishing.', 'public');
  assert (select status from public.components where id = tests.gateway()) = 'major_outage';
  assert (select published_at from public.incidents where id = v_incident.id) is not null;
  perform public.post_incident_update(v_incident.id, 'resolved', 'Fixed.', 'public');
end $$;

-- Maintenance windows
do $$
declare
  v_maintenance public.maintenances;
begin
  v_maintenance := public.create_maintenance(tests.payments(), 'DB upgrade', 'Minor version', now() - interval '1 minute', now() + interval '30 minutes', array[tests.gateway()]);
  assert v_maintenance.status = 'in_progress', 'auto-started because start is in the past';
  assert (select status from public.components where id = tests.gateway()) = 'maintenance';
  perform public.post_maintenance_update(v_maintenance.id, 'Replica caught up, switching over.', 'deploy-bot');
  assert (select actor_label from public.maintenance_updates where maintenance_id = v_maintenance.id and message like 'Replica%') = 'deploy-bot';
  perform public.set_maintenance_status(v_maintenance.id, 'completed', 'Done early.', 'deploy-bot');
  assert (select status from public.components where id = tests.gateway()) = 'operational';
  assert (select count(*) from public.maintenance_updates where maintenance_id = v_maintenance.id) = 4;
end $$;

-- Dependencies: the API depends on the gateway
do $$
begin
  insert into public.component_dependencies (component_id, depends_on_id, impact) values (tests.payments_api(), tests.gateway(), 'partial_outage');
  begin
    insert into public.component_dependencies (component_id, depends_on_id) values (tests.gateway(), tests.payments_api());
    raise exception 'cycle should be rejected';
  exception when check_violation then null;
  end;
end $$;

select tests.as_postgres();
do $$
begin
  -- Close the legacy incident so the API follows its dependency
  perform public.post_incident_update('00000000-0000-0000-0000-00000000e001', 'resolved', 'Done.', 'public');
  assert (select status from public.components where id = tests.payments_api()) = 'operational';
  update public.components set automated_status = 'major_outage', automated_source = 'monitor' where id = tests.gateway();
  assert (select status from public.components where id = tests.gateway()) = 'major_outage';
  assert (select status from public.components where id = tests.payments_api()) = 'partial_outage', 'dependency impact applied';
  assert (select status_source from public.components where id = tests.payments_api()) = 'dependency';
  update public.components set automated_status = 'operational' where id = tests.gateway();
  assert (select status from public.components where id = tests.payments_api()) = 'operational';
end $$;

-- Viewers cannot run incidents; strangers cannot touch them
select tests.as_user(tests.mallory());
do $$
begin
  begin
    perform public.create_incident(tests.payments(), 'Hacked', 'x', 'investigating', 'critical', '{}'::jsonb);
    raise exception 'stranger created an incident';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.post_incident_update('00000000-0000-0000-0000-00000000e001', 'resolved', 'x', 'public');
    raise exception 'stranger updated an incident';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.incidents), 'stranger sees no incidents';
end $$;

-- Component limits per plan (M-7): bob is on free (10 components)
select tests.as_user(tests.bob());
do $$
declare
  i integer;
begin
  for i in 1..9 loop
    insert into public.components (project_id, name) values (tests.blog(), 'C' || i);
  end loop;
  begin
    insert into public.components (project_id, name) values (tests.blog(), 'One too many');
    raise exception 'component limit not enforced';
  exception when raise_exception then
    if sqlerrm not like '%components per status page%' then raise; end if;
  end;
end $$;

rollback;
