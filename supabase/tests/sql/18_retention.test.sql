-- Retention: raw check results are kept 7 days on Free, 14 on Pro and 30 on Business; other data keeps its window.
begin;

select tests.as_postgres();
set local upvane.suppress_events = 'on';

create temporary table t_ages (days integer);
insert into t_ages values (1), (6), (8), (13), (15), (29), (31);

delete from public.monitor_check_results where project_id = tests.payments();
insert into public.monitor_check_results (project_id, region, status, checked_at)
select tests.payments(), 'eu-central-1', 'up', now() - make_interval(days => days) from t_ages;

do $$
declare
  v_org uuid := (select organization_id from public.projects where id = tests.payments());
  v_plan text;
  v_expected jsonb := '{"free": 2, "pro": 4, "business": 6}';
  v_left integer;
  v_result jsonb;
begin
  foreach v_plan in array array['business', 'pro', 'free'] loop
    update public.organizations set plan = v_plan where id = v_org;
    v_result := public.purge_old_data();
    v_left := (select count(*) from public.monitor_check_results where project_id = tests.payments());
    if v_left <> (v_expected ->> v_plan)::integer then
      raise exception 'On %, expected % check results to remain, found %', v_plan, v_expected ->> v_plan, v_left;
    end if;
    if not (v_result ->> 'check_results_complete')::boolean then
      raise exception 'The purge should finish within its budget on a small table: %', v_result;
    end if;
  end loop;
end $$;

-- Retention days per plan (unknown plans fall back to Free).
do $$
begin
  if public.check_result_retention_days('free') <> 7 or public.check_result_retention_days('pro') <> 14
     or public.check_result_retention_days('business') <> 30 or public.check_result_retention_days(null) <> 7 then
    raise exception 'check_result_retention_days returned unexpected values';
  end if;
end $$;

-- Audit log and status history keep 400 days, idempotency keys 1 day.
insert into public.audit_logs (organization_id, actor_type, actor_label, action, created_at)
values ((select organization_id from public.projects where id = tests.payments()), 'system', 'test', 'test.old', now() - interval '401 days'),
       ((select organization_id from public.projects where id = tests.payments()), 'system', 'test', 'test.recent', now() - interval '399 days');
select public.purge_old_data();
do $$
begin
  if exists (select 1 from public.audit_logs where action = 'test.old') then
    raise exception 'Audit log entries older than 400 days should be purged';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'test.recent') then
    raise exception 'Audit log entries younger than 400 days should be kept';
  end if;
end $$;

-- Only the service role can run the purge.
select tests.as_user(tests.alice());
do $$
begin
  perform public.purge_old_data();
  raise exception 'purge_old_data should not be callable by users';
exception when insufficient_privilege then
  null;
end $$;

rollback;
