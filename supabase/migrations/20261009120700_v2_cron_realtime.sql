-- ==========================================
-- Migration: v2 scheduled jobs, retention and realtime
-- ==========================================
-- Cron jobs read their secrets from Vault every time they run, so no secret is stored in cron.job (B-12).
-- Run `select public.schedule_upvane_jobs();` again after creating or rotating the Vault secrets:
--   SUPABASE_URL, MONITOR_RUNNER_SECRET, ALERT_WORKER_SECRET

create or replace function public.purge_old_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_results integer;
  v_events integer;
  v_misc integer;
begin
  with doomed as (
    select r.id from public.monitor_check_results r
    join public.projects p on p.id = r.project_id
    join public.organizations o on o.id = p.organization_id
    where r.checked_at < now() - make_interval(days => least(400, greatest(30, public.plan_limit(o.plan, 'history_days'))))
    limit 200000
  )
  delete from public.monitor_check_results r using doomed where r.id = doomed.id;
  get diagnostics v_results = row_count;

  delete from public.alert_events where created_at < now() - interval '180 days';
  get diagnostics v_events = row_count;

  delete from public.component_status_history where changed_at < now() - interval '400 days';
  delete from public.rate_limit_buckets where window_start < now() - interval '2 days';
  delete from public.api_idempotency_keys where created_at < now() - interval '1 day';
  delete from public.audit_logs where created_at < now() - interval '400 days';
  delete from public.organization_invitations where expires_at < now() - interval '30 days' and accepted_at is null;
  get diagnostics v_misc = row_count;

  return jsonb_build_object('check_results', v_results, 'alert_events', v_events, 'invitations', v_misc);
end;
$$;

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
  perform cron.schedule('upvane-retention', '17 3 * * *', 'select public.purge_old_data()');

  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return 'SQL jobs scheduled. pg_net or Vault is missing, so monitor-runner and alert-worker were not scheduled.';
  end if;

  perform cron.schedule('upvane-monitor-runner', '30 seconds', format(v_http_job, 'monitor-runner', 'MONITOR_RUNNER_SECRET'));
  perform cron.schedule('upvane-alert-worker', '* * * * *', format(v_http_job, 'alert-worker', 'ALERT_WORKER_SECRET'));
  return 'All Upvane jobs scheduled.';
end;
$$;

revoke execute on function public.purge_old_data() from public, anon, authenticated;
grant execute on function public.purge_old_data() to service_role;
revoke execute on function public.schedule_upvane_jobs() from public, anon, authenticated;
grant execute on function public.schedule_upvane_jobs() to service_role;

do $$
begin
  raise notice '%', public.schedule_upvane_jobs();
exception when others then
  raise notice 'Upvane jobs not scheduled: %', sqlerrm;
end $$;

-- ------------------------------------------------------------------
-- Realtime: the dashboard refreshes when these tables change (RLS still applies)
-- ------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['components', 'incidents', 'incident_updates', 'incident_components', 'maintenances', 'monitors'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
