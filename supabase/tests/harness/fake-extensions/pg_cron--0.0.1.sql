-- Test-only stand-in for pg_cron: stores jobs, never runs them.
create schema if not exists cron;

create table if not exists cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text default 'localhost',
  nodeport integer default 5432,
  database text default current_database(),
  username text default current_user,
  active boolean default true,
  jobname text unique
);

create table if not exists cron.job_run_details (
  jobid bigint,
  runid bigserial primary key,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);

create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid into v_id;
  return v_id;
end;
$$;

create or replace function cron.unschedule(job_name text) returns boolean
language plpgsql as $$
declare v_count integer;
begin
  delete from cron.job where jobname = job_name;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
