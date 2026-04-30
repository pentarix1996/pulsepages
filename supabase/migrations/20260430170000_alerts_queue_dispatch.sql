-- ==========================================
-- Migration: Alerts Queue Dispatch
-- ==========================================
-- Supabase Queues/PGMQ transport for durable alert deliveries.

create schema if not exists pgmq;
create schema if not exists extensions;
create schema if not exists vault;

create extension if not exists pgmq with schema pgmq;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  perform pgmq.create('alert-deliveries');
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

alter table public.alert_channel_configs
  add column if not exists secret_ref text;

alter table public.alert_deliveries
  add column if not exists queued_at timestamptz,
  add column if not exists dispatched_at timestamptz,
  add column if not exists queue_message_id bigint;

alter table public.project_alert_configs
  alter column alert_types set default '{"component_status":true,"monitor_failure":true,"incident_created":false,"incident_updated":false,"incident_resolved":false}'::jsonb;

create index if not exists alert_deliveries_queue_message_idx on public.alert_deliveries(queue_message_id) where queue_message_id is not null;
create index if not exists alert_deliveries_queue_recovery_idx on public.alert_deliveries(status, queued_at, next_retry_at) where status in ('pending', 'retryable');

create or replace function public.alert_delivery_queue_message(
  p_delivery_id uuid,
  p_event_id uuid,
  p_project_id uuid,
  p_channel text
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'deliveryId', p_delivery_id::text,
    'eventId', p_event_id::text,
    'projectId', p_project_id::text,
    'channel', p_channel
  )
$$;

create or replace function public.enqueue_alert_delivery_message(p_delivery_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_delivery record;
  v_msg_id bigint;
begin
  select d.id, d.event_id, e.project_id, c.type
    into v_delivery
  from public.alert_deliveries d
  join public.alert_events e on e.id = d.event_id
  join public.alert_channel_configs c on c.id = d.channel_config_id
  where d.id = p_delivery_id;

  if not found then
    raise exception 'alert delivery not found: %', p_delivery_id;
  end if;

  select pgmq.send(
    'alert-deliveries',
    public.alert_delivery_queue_message(v_delivery.id, v_delivery.event_id, v_delivery.project_id, v_delivery.type)
  ) into v_msg_id;

  update public.alert_deliveries
  set queued_at = timezone('utc'::text, now()),
      queue_message_id = v_msg_id,
      updated_at = timezone('utc'::text, now())
  where id = p_delivery_id;

  return v_msg_id;
end;
$$;

create or replace function public.enqueue_alert_event_and_dispatch(
  p_project_id uuid,
  p_type text,
  p_source_type text,
  p_source_id text,
  p_severity text,
  p_dedupe_key text,
  p_payload jsonb
)
returns table(event_id uuid, delivery_count integer, message_count integer)
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_event_id uuid;
  v_delivery record;
  v_delivery_count integer := 0;
  v_message_count integer := 0;
begin
  insert into public.alert_events(project_id, type, source_type, source_id, severity, dedupe_key, payload)
  values (p_project_id, p_type, p_source_type, p_source_id, p_severity, p_dedupe_key, p_payload)
  returning id into v_event_id;

  for v_delivery in
    insert into public.alert_deliveries(event_id, channel_config_id, target, idempotency_key)
    select v_event_id, c.id, recipient.target, v_event_id::text || ':' || c.id::text || ':' || recipient.target
    from public.alert_channel_configs c
    cross join lateral jsonb_array_elements_text(coalesce(c.config->'recipients', '[]'::jsonb)) recipient(target)
    where c.project_id = p_project_id
      and c.enabled = true
      and c.type = 'email'
    on conflict (idempotency_key) do nothing
    returning id
  loop
    v_delivery_count := v_delivery_count + 1;
    perform public.enqueue_alert_delivery_message(v_delivery.id);
    v_message_count := v_message_count + 1;
  end loop;

  return query select v_event_id, v_delivery_count, v_message_count;
end;
$$;

create or replace function public.recover_alert_delivery_queue(p_limit integer default 50)
returns table(delivery_id uuid, message_id bigint)
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_delivery record;
  v_message_id bigint;
begin
  insert into public.alert_deliveries(event_id, channel_config_id, target, idempotency_key)
  select e.id, c.id, recipient.target, e.id::text || ':' || c.id::text || ':' || recipient.target
  from public.alert_events e
  join public.alert_channel_configs c on c.project_id = e.project_id and c.enabled = true and c.type = 'email'
  cross join lateral jsonb_array_elements_text(coalesce(c.config->'recipients', '[]'::jsonb)) recipient(target)
  where e.status in ('pending', 'failed')
    and not exists (select 1 from public.alert_deliveries d where d.event_id = e.id)
  on conflict (idempotency_key) do nothing;

  for v_delivery in
    select d.id
    from public.alert_deliveries d
    where d.status in ('pending', 'retryable')
      and (d.next_retry_at is null or d.next_retry_at <= timezone('utc'::text, now()))
      and (d.queued_at is null or d.queued_at < timezone('utc'::text, now()) - interval '3 minutes')
    order by d.created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_message_id := public.enqueue_alert_delivery_message(v_delivery.id);
    delivery_id := v_delivery.id;
    message_id := v_message_id;
    return next;
  end loop;
end;
$$;

create or replace function public.alert_worker_read_messages(p_batch_size integer default 10, p_visibility_timeout integer default 60)
returns table(msg_id bigint, message jsonb)
language sql
security definer
set search_path = public, pgmq
as $$
  select r.msg_id, r.message
  from pgmq.read('alert-deliveries', greatest(10, p_visibility_timeout), greatest(1, least(p_batch_size, 50))) as r
$$;

create or replace function public.alert_worker_delete_message(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.delete('alert-deliveries', p_msg_id)
$$;

create or replace function public.alert_worker_defer_message(p_msg_id bigint, p_delay_seconds integer)
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.set_vt('alert-deliveries', p_msg_id, greatest(1, least(coalesce(p_delay_seconds, 1), 2147483647)));
end;
$$;

create or replace function public.schedule_alert_worker_fallback()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'SUPABASE_URL' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name in ('ALERT_WORKER_SECRET', 'ALERTS_DISPATCHER_SECRET') limit 1;

  if v_url is null or v_secret is null then
    raise notice 'alert-worker cron not scheduled: missing SUPABASE_URL or alert worker secret in Vault';
    return;
  end if;

  perform cron.unschedule('alert-worker-fallback') where exists (select 1 from cron.job where jobname = 'alert-worker-fallback');
  perform cron.schedule(
    'alert-worker-fallback',
    '*/3 * * * *',
    format($job$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
        body := '{"source":"cron"}'::jsonb
      );
    $job$, v_url || '/functions/v1/alert-worker', v_secret)
  );
end;
$$;

revoke all on function public.alert_worker_read_messages(integer, integer) from anon, authenticated;
revoke all on function public.alert_worker_delete_message(bigint) from anon, authenticated;
revoke all on function public.alert_worker_defer_message(bigint, integer) from anon, authenticated;
revoke all on function public.recover_alert_delivery_queue(integer) from anon, authenticated;
revoke all on function public.enqueue_alert_delivery_message(uuid) from anon, authenticated;
