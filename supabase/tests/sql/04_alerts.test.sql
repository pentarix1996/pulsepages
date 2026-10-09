-- Alert routing, anti-flap cooldowns, maintenance mute, recipients verification, subscribers, privileges (A-1, A-8, C-3)
begin;

do $$
declare
  v_channel uuid := (select id from public.alert_channels where legacy_config_id = '00000000-0000-0000-0000-00000000d001');
begin
  assert v_channel is not null, 'legacy email channel migrated';
  assert (select verified_at from public.alert_email_recipients where channel_id = v_channel and email = 'alice@example.com') is not null, 'member email verified';
  assert (select verified_at from public.alert_email_recipients where channel_id = v_channel and email = 'stranger@spam.example') is null, 'stranger needs to confirm';
  assert (select count(*) from public.alert_rules where project_id = tests.payments()) = 2, 'default rules';
  assert (select enabled from public.alert_rules where project_id = tests.payments() and position = 1), 'incident rule enabled from legacy toggles';
end $$;

-- C-3: nobody but service_role can enqueue or touch the queue
select tests.as_anon();
do $$
begin
  begin
    perform public.enqueue_alert_event_and_dispatch(tests.payments(), 'test', 'test', null, 'test', 'x', '{}'::jsonb);
    raise exception 'anon enqueued';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.alert_worker_read_messages(10, 60);
    raise exception 'anon read queue';
  exception when insufficient_privilege then null;
  end;
end $$;

select tests.as_user(tests.mallory());
do $$
begin
  begin
    perform public.enqueue_alert_event_and_dispatch(tests.payments(), 'test', 'test', null, 'test', 'x', '{}'::jsonb);
    raise exception 'authenticated enqueued';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Routing and anti-flap
select tests.as_service();
do $$
declare
  r record;
  v_key text := 'component:' || tests.gateway();
  v_payload jsonb := jsonb_build_object('component', jsonb_build_object('id', tests.gateway()), 'status', 'degraded');
begin
  -- First worsening: one delivery (only the verified recipient)
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_status_worsened', 'monitor', null, 'degraded', v_key, v_payload);
  assert r.delivery_count = 1, format('expected 1 delivery, got %s', r.delivery_count);
  assert (select target from public.alert_deliveries where event_id = r.event_id) = 'alice@example.com';
  assert (select target_type from public.alert_deliveries where event_id = r.event_id) = 'email';

  -- Same severity inside the cooldown: suppressed
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_status_worsened', 'monitor', null, 'degraded', v_key, v_payload);
  assert r.delivery_count = 0;
  assert (select suppression_reason from public.alert_events where id = r.event_id) = 'cooldown';

  -- Escalation is new information: sent
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_status_worsened', 'monitor', null, 'major_outage', v_key, v_payload || '{"status": "major_outage"}');
  assert r.delivery_count = 1, 'escalation sent';

  -- Recovery after a sent problem: sent once
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_recovered', 'monitor', null, 'operational', v_key, v_payload || '{"status": "operational"}');
  assert r.delivery_count = 1, 'recovery sent';
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_recovered', 'monitor', null, 'operational', v_key, v_payload || '{"status": "operational"}');
  assert r.delivery_count = 0, 'duplicate recovery suppressed';

  -- Orphan recovery (nothing was announced) is suppressed
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_recovered', 'monitor', null, 'operational', 'component:' || tests.webhooks(),
    jsonb_build_object('component', jsonb_build_object('id', tests.webhooks()), 'status', 'operational'));
  assert r.delivery_count = 0;

  -- Events no rule listens to
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'incident_draft_created', 'monitor', null, 'minor', 'd', '{}'::jsonb);
  assert (select suppression_reason from public.alert_events where id = r.event_id) = 'no_matching_rule';

  -- Every delivery has a queue message
  assert not exists (select 1 from public.alert_deliveries where queued_at is null or queue_message_id is null), 'every delivery queued';
end $$;

-- Maintenance mutes component alerts; master switch disables everything
select tests.as_postgres();
do $$
declare
  r record;
  v_maintenance public.maintenances;
begin
  v_maintenance := public.create_maintenance(tests.payments(), 'Window', '', now() - interval '1 minute', now() + interval '1 hour', array[tests.webhooks()]);
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'component_status_worsened', 'monitor', null, 'major_outage', 'component:' || tests.webhooks(),
    jsonb_build_object('component', jsonb_build_object('id', tests.webhooks()), 'status', 'major_outage'));
  assert (select suppression_reason from public.alert_events where id = r.event_id) = 'maintenance';

  update public.project_alert_configs set enabled = false where project_id = tests.payments();
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'incident_created', 'incident', null, 'major', 'i', '{}'::jsonb);
  assert (select suppression_reason from public.alert_events where id = r.event_id) = 'alerts_disabled';
  update public.project_alert_configs set enabled = true where project_id = tests.payments();
end $$;

-- Test events go to one channel, ignoring rules; unverified recipients never receive anything (A-8)
select tests.as_service();
do $$
declare
  r record;
  v_channel uuid := (select id from public.alert_channels where legacy_config_id = '00000000-0000-0000-0000-00000000d001');
begin
  select * into r from public.enqueue_alert_event_and_dispatch(tests.payments(), 'test', 'test', null, 'test', 'test:1', jsonb_build_object('channel_id', v_channel));
  assert r.delivery_count = 1;
  assert not exists (select 1 from public.alert_deliveries where target = 'stranger@spam.example');
end $$;

-- Dashboard writes cannot self-verify recipients
select tests.as_user(tests.alice());
do $$
declare
  v_channel uuid := (select id from public.alert_channels where legacy_config_id = '00000000-0000-0000-0000-00000000d001');
begin
  insert into public.alert_email_recipients (channel_id, email, verified_at) values (v_channel, 'Other@Spam.example', now());
  assert (select verified_at from public.alert_email_recipients where email = 'other@spam.example') is null;
  insert into public.alert_email_recipients (channel_id, email) values (v_channel, 'bob@example.com');
  assert (select verified_at from public.alert_email_recipients where email = 'bob@example.com') is null, 'bob is not a member of alice''s org';
  -- Paging channels need Business
  begin
    insert into public.alert_channels (project_id, type, name) values (tests.payments(), 'pagerduty', 'PD');
    raise exception 'pagerduty on pro';
  exception when raise_exception then null;
  end;
end $$;

-- Recipient verification by token
select tests.as_service();
do $$
declare
  v_result jsonb;
begin
  update public.alert_email_recipients set token_hash = encode(extensions.digest('verify-me', 'sha256'), 'hex') where email = 'stranger@spam.example';
  v_result := public.verify_alert_recipient('verify-me');
  assert v_result->>'email' = 'stranger@spam.example';
  assert (select verified_at from public.alert_email_recipients where email = 'stranger@spam.example') is not null;
end $$;

-- Subscribers: double opt-in, plan limit, component filters
do $$
declare
  v_status text;
  v_count integer;
begin
  v_status := public.subscribe_to_status_page(tests.payments(), 'email', 'Reader@Example.com', null, null, '{}', 'confirm-hash', 'unsub-hash');
  assert v_status = 'confirmation_sent';
  v_count := public.enqueue_subscriber_notification(tests.payments(), 'incident_created', gen_random_uuid(), '{}', '{}'::jsonb);
  assert v_count = 0, 'unconfirmed subscribers get nothing';
  assert (public.confirm_status_page_subscription('confirm-hash'))->>'email' = 'reader@example.com';
  v_status := public.subscribe_to_status_page(tests.payments(), 'webhook', null, 'v1.encrypted', 'hooks.example.com', array[tests.webhooks()], null, 'unsub-hook');
  assert v_status = 'subscribed';
  v_count := public.enqueue_subscriber_notification(tests.payments(), 'incident_created', gen_random_uuid(), array[tests.gateway()], '{}'::jsonb);
  assert v_count = 1, format('only the unfiltered subscriber, got %s', v_count);
  v_count := public.enqueue_subscriber_notification(tests.payments(), 'incident_created', gen_random_uuid(), array[tests.webhooks()], '{}'::jsonb);
  assert v_count = 2;
  assert (public.unsubscribe_from_status_page('unsub-hash'))->>'email' = 'reader@example.com';
end $$;

-- Worker lifecycle: claim, complete, recover stuck deliveries (M-3)
do $$
declare
  v_delivery uuid;
  v_attempts integer;
begin
  select id into v_delivery from public.alert_deliveries where status = 'pending' and target_type = 'email' limit 1;
  assert public.alert_worker_load_delivery(v_delivery) -> 'channel' ->> 'type' = 'email';
  v_attempts := public.alert_worker_claim_delivery(v_delivery);
  assert v_attempts = 1;
  assert public.alert_worker_claim_delivery(v_delivery) is null, 'cannot claim twice';
  update public.alert_deliveries set updated_at = now() - interval '10 minutes' where id = v_delivery;
  perform public.recover_alert_delivery_queue(10);
  assert (select status from public.alert_deliveries where id = v_delivery) = 'retryable';
  perform public.alert_worker_claim_delivery(v_delivery);
  perform public.alert_worker_complete_delivery(v_delivery, 'sent', 'resend', 'msg_1', null, null, null);
  assert (select status from public.alert_deliveries where id = v_delivery) = 'sent';
end $$;

rollback;
