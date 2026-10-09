-- Data in the pre-v2 shape. Applied right before the first v2 migration so the upgrade path is tested.
-- Users: alice (pro, owns "Payments"), bob (free, owns "Blog"), mallory (free, abused C-1 against alice).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@example.com', '{"name": "Alice Admin"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'bob@example.com', '{"name": "Bob"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'mallory@example.com', '{"name": "Mallory"}');

update public.profiles set plan = 'pro' where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.projects (id, user_id, name, slug, description, created_at) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'Payments', 'payments', 'Card payments', now() - interval '60 days'),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', 'Blog', 'blog', null, now() - interval '20 days');

insert into public.components (id, project_id, name, status) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000aa01', 'API Gateway', 'operational'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-00000000aa01', 'Payments API', 'partial_outage'),
  ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-00000000aa01', 'Webhooks', 'operational'),
  ('00000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-00000000bb01', 'Web', 'weird-status');

insert into public.component_status_history (component_id, status, changed_at, reason) values
  ('00000000-0000-0000-0000-0000000c0002', 'partial_outage', now() - interval '2 hours', 'incident');

insert into public.incidents (id, project_id, title, description, status, severity, component_ids, created_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000aa01', 'Failed payments', 'Card payments failing', 'identified', 'high',
   array['00000000-0000-0000-0000-0000000c0002']::uuid[], now() - interval '2 hours'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000aa01', 'Old outage', 'Resolved long ago', 'resolved', 'critical',
   array['00000000-0000-0000-0000-0000000c0001']::uuid[], now() - interval '40 days'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000aa01', 'Planned work', 'Legacy maintenance incident', 'maintenance', 'low',
   '{}'::uuid[], now() - interval '3 days');

insert into public.incident_updates (incident_id, message, status, created_at) values
  ('00000000-0000-0000-0000-00000000e001', 'Investigating failed payments.', 'investigating', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-00000000e001', 'Root cause identified.', 'identified', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000e002', 'Fixed.', 'resolved', now() - interval '39 days');

insert into public.component_monitor_configs (id, project_id, component_id, mode, enabled, url, method, interval_seconds, timeout_ms, expected_status_codes, response_type, json_rules, failure_status, no_match_status)
values (
  '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000c0001',
  'automatic', true, 'https://api.example.com/health', 'GET', 60, 5000, array[200], 'json',
  '[{"path": "status", "operator": "equals", "value": "ok", "targetStatus": "operational"}, {"path": "db", "operator": "equals", "value": "down", "targetStatus": "major_outage"}]'::jsonb,
  'major_outage', 'degraded'
);

insert into public.monitor_check_results (config_id, project_id, component_id, status, resulting_status, http_status, response_time_ms, checked_at)
values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000c0001', 'success', 'operational', 200, 120, now() - interval '1 minute');

insert into public.project_alert_configs (project_id, enabled, cooldown_minutes, notify_recovery, alert_types)
values ('00000000-0000-0000-0000-00000000aa01', true, 30, true, '{"component_status": true, "monitor_failure": true, "incident_created": true, "incident_updated": false, "incident_resolved": false}');

insert into public.alert_channel_configs (id, project_id, type, enabled, config)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000aa01', 'email', true,
        '{"recipients": ["alice@example.com", "Stranger@Spam.example"], "template_variant": "default"}');

insert into public.api_keys (id, user_id, project_id, token_hash, name) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa01', repeat('a', 64), 'CI'),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000aa01', repeat('b', 64), 'Stolen');
