-- finalize_alert_event: two workers finishing the last two deliveries of an event at the same time could each see the
-- other delivery as still open and leave the event pending forever. Locking the event row first serialises them; the
-- second one then counts with the first one's result committed.
create or replace function public.finalize_alert_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open integer;
  v_total integer;
  v_suppressed integer;
begin
  perform 1 from public.alert_events where id = p_event_id for update;
  if not found then
    return;
  end if;
  select count(*) filter (where status in ('pending', 'retryable', 'processing')),
         count(*),
         count(*) filter (where status = 'suppressed')
  into v_open, v_total, v_suppressed
  from public.alert_deliveries where event_id = p_event_id;
  if v_total = 0 or v_open > 0 then
    return;
  end if;
  update public.alert_events
  set status = case when v_suppressed = v_total then 'suppressed' else 'processed' end, processed_at = now()
  where id = p_event_id and status = 'pending';
end;
$$;

revoke execute on function public.finalize_alert_event(uuid) from public, anon, authenticated;
grant execute on function public.finalize_alert_event(uuid) to service_role;
