-- ==========================================
-- Migration: shorter, plan-based retention for raw monitor check results
-- ==========================================
-- Every check of every region is a row. Nothing in the product reads raw results older than 7 days (charts cover 24 h
-- and 7 days, uptime comes from component_status_history), so raw rows are kept 7 days on Free, 14 on Pro and 30 on
-- Business instead of the status page history window (up to 400 days). The purge now walks each project through the
-- (project_id, checked_at) index in batches with a time budget, and runs every hour so a busy day never piles up.

create or replace function public.check_result_retention_days(p_plan text)
returns integer
language sql
immutable
as $$
  select case p_plan when 'business' then 30 when 'pro' then 14 else 7 end
$$;

create or replace function public.purge_old_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project record;
  v_batch integer;
  v_results bigint := 0;
  v_events integer;
  v_misc integer;
  v_started timestamptz := clock_timestamp();
  v_budget interval := interval '5 minutes';
  v_complete boolean := true;
begin
  <<projects>>
  for v_project in
    select p.id, now() - make_interval(days => public.check_result_retention_days(o.plan)) as cutoff
    from public.projects p
    join public.organizations o on o.id = p.organization_id
    order by p.id
  loop
    loop
      delete from public.monitor_check_results r
      where r.ctid = any (array(
        select x.ctid from public.monitor_check_results x
        where x.project_id = v_project.id and x.checked_at < v_project.cutoff
        limit 20000
      ));
      get diagnostics v_batch = row_count;
      v_results := v_results + v_batch;
      if clock_timestamp() - v_started > v_budget then
        v_complete := v_batch < 20000;
        exit projects;
      end if;
      exit when v_batch < 20000;
    end loop;
  end loop;

  delete from public.alert_events where created_at < now() - interval '180 days';
  get diagnostics v_events = row_count;

  delete from public.component_status_history where changed_at < now() - interval '400 days';
  delete from public.rate_limit_buckets where window_start < now() - interval '2 days';
  delete from public.api_idempotency_keys where created_at < now() - interval '1 day';
  delete from public.audit_logs where created_at < now() - interval '400 days';
  delete from public.organization_invitations where expires_at < now() - interval '30 days' and accepted_at is null;
  get diagnostics v_misc = row_count;

  return jsonb_build_object('check_results', v_results, 'check_results_complete', v_complete, 'alert_events', v_events, 'invitations', v_misc);
end;
$$;

revoke execute on function public.purge_old_data() from public, anon, authenticated;
grant execute on function public.purge_old_data() to service_role;

-- Same jobs as before; only upvane-retention moves from daily to hourly.
create or replace function public.schedule_upvane_jobs()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job text;
  v_http_job text := $job$
    select net.http_post(
      url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL' limit 1), '/') || '/functions/v1/%s',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '%s' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    )
  $job$;
begin
  if to_regnamespace('cron') is null then
    return 'pg_cron is not installed; schedule the jobs manually (see docs/06-operations.md).';
  end if;

  foreach v_job in array array['monitor-runner-every-minute', 'monitor-runner-every-30-seconds', 'alert-worker-fallback',
                               'upvane-monitor-runner', 'upvane-alert-worker', 'upvane-maintenance-windows', 'upvane-heartbeats', 'upvane-retention'] loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;

  perform cron.schedule('upvane-maintenance-windows', '* * * * *', 'select public.process_maintenance_windows()');
  perform cron.schedule('upvane-heartbeats', '* * * * *', 'select public.process_heartbeats()');
  perform cron.schedule('upvane-retention', '17 * * * *', 'select public.purge_old_data()');

  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return 'SQL jobs scheduled. pg_net or Vault is missing, so monitor-runner and alert-worker were not scheduled.';
  end if;

  perform cron.schedule('upvane-monitor-runner', '30 seconds', format(v_http_job, 'monitor-runner', 'MONITOR_RUNNER_SECRET'));
  perform cron.schedule('upvane-alert-worker', '* * * * *', format(v_http_job, 'alert-worker', 'ALERT_WORKER_SECRET'));
  return 'All Upvane jobs scheduled.';
end;
$$;

revoke execute on function public.schedule_upvane_jobs() from public, anon, authenticated;
grant execute on function public.schedule_upvane_jobs() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null and exists (select 1 from cron.job where jobname = 'upvane-retention') then
    perform cron.schedule('upvane-retention', '17 * * * *', 'select public.purge_old_data()');
  end if;
end $$;
