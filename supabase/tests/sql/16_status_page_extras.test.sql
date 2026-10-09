-- Status page extras: private access info, newer history pages, unsubscribe lookup
begin;

select tests.as_postgres();
set local upvane.suppress_events = 'on';

create temporary table t_page as select username as org_slug from public.profiles where id = tests.alice();
grant select on t_page to anon, authenticated, service_role;

-- A known history: five resolved incidents one day apart (newest is 1 day old) and one completed maintenance.
insert into public.incidents (id, project_id, title, status, impact, detected_at, published_at, resolved_at, created_at)
select ('00000000-0000-0000-0000-00000e1000' || lpad(n::text, 2, '0'))::uuid, tests.payments(), 'History ' || n, 'resolved', 'minor',
  now() - make_interval(days => n), now() - make_interval(days => n), now() - make_interval(days => n) + interval '30 minutes',
  now() - make_interval(days => n)
from generate_series(1, 5) as n;

insert into public.maintenances (project_id, title, status, scheduled_start, scheduled_end, actual_start, actual_end)
values (tests.payments(), 'Planned upgrade', 'completed', now() - interval '2 days 12 hours', now() - interval '2 days 11 hours',
  now() - interval '2 days 12 hours', now() - interval '2 days 11 hours');

update public.organizations set sso_domain = 'payments.example' where id = (select organization_id from public.projects where id = tests.payments());
update public.projects set allowed_ips = array['203.0.113.0/24', '2001:db8::/32'] where id = tests.payments();

-- Newer pages: strictly after the cursor, newest first, at most p_limit items, same filters as the history
select tests.as_anon();
do $$
declare
  v_org text := (select org_slug from t_page);
  v_page jsonb;
  v_items jsonb;
begin
  -- The two items right after the cursor are the maintenance (2.5 days old) and "History 2", newest first.
  v_page := public.get_status_page_history_newer(v_org, 'payments', now() - interval '2 days 18 hours', 2);
  assert v_page is not null, 'public page readable';
  v_items := v_page->'items';
  assert jsonb_array_length(v_items) = 2, 'limit respected';
  assert v_items->0->'item'->>'title' = 'History 2', 'newest first';
  assert v_items->1->>'kind' = 'maintenance', 'oldest of the newer page last';
  assert v_items->1->'item'->>'title' = 'Planned upgrade';
  assert v_page->'project'->>'slug' = 'payments';

  -- Strictly after the cursor: an item exactly at the cursor belongs to the older page
  v_items := public.get_status_page_history_newer(v_org, 'payments', now() - interval '2 days', 20)->'items';
  assert not exists (select 1 from jsonb_array_elements(v_items) e where e->'item'->>'title' = 'History 2'), 'cursor item excluded';
  assert exists (select 1 from jsonb_array_elements(v_items) e where e->'item'->>'title' = 'History 1');

  v_items := public.get_status_page_history_newer(v_org, 'payments', now() - interval '3 hours', 20)->'items';
  assert jsonb_array_length(v_items) = 1, 'only the active incident is newer than three hours ago';
  assert v_items->0->'item'->>'title' = 'Failed payments';

  -- Paging back and forth is consistent: older page from the history, newer page from the extra function
  v_items := public.get_status_page_history(v_org, 'payments', now() - interval '1 day 1 hour', 3)->'items';
  assert jsonb_array_length(v_items) = 3;
  assert v_items->0->'item'->>'title' = 'History 2';
  v_items := public.get_status_page_history_newer(v_org, 'payments', (v_items->0->>'at')::timestamptz, 20)->'items';
  assert v_items->(jsonb_array_length(v_items) - 1)->'item'->>'title' = 'History 1', 'newer page starts right after the cursor';

  assert public.get_status_page_history_newer(v_org, 'nope', now() - interval '1 day', 5) is null, 'unknown page';
  begin
    perform public.get_status_page_history_newer(v_org, 'payments', null, 5);
    raise exception 'missing cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Server-only helpers are not callable by visitors or users
do $$
begin
  begin
    perform public.status_page_access_info(tests.payments());
    raise exception 'anon read access info';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_status_page_subscription('x');
    raise exception 'anon read a subscription';
  exception when insufficient_privilege then null;
  end;
end $$;

select tests.as_user(tests.alice());
do $$
begin
  begin
    perform public.status_page_access_info(tests.payments());
    raise exception 'member read access info through the API';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Private pages: the newer history follows the same access rules as the rest of the page
select tests.as_postgres();
update public.organizations set plan = 'business' where id = (select organization_id from public.projects where id = tests.payments());
update public.projects set visibility = 'private' where id = tests.payments();

select tests.as_anon();
do $$
begin
  assert public.get_status_page_history_newer((select org_slug from t_page), 'payments', now() - interval '3 days', 5) is null, 'private page hidden from visitors';
end $$;

select tests.as_user(tests.alice());
do $$
begin
  assert jsonb_array_length(public.get_status_page_history_newer((select org_slug from t_page), 'payments', now() - interval '3 days', 5)->'items') >= 3, 'members page through history';
end $$;

select tests.as_service();
do $$
declare
  v_info jsonb := public.status_page_access_info(tests.payments());
begin
  assert v_info->>'visibility' = 'private';
  assert v_info->>'sso_domain' = 'payments.example';
  assert v_info->'allowed_ips' = '["203.0.113.0/24", "2001:db8::/32"]'::jsonb, 'allowed ranges as a JSON array';
  assert v_info->>'slug' = 'payments';
  assert v_info->>'organization_slug' = (select org_slug from t_page);
  assert v_info->>'custom_domain' is null, 'unverified domains are not exposed';
  assert public.status_page_access_info('00000000-0000-0000-0000-000000000000') is null, 'unknown project';
  assert jsonb_array_length(public.get_status_page_history_newer((select org_slug from t_page), 'payments', now() - interval '3 days', 5)->'items') >= 3, 'server pages through private history';
end $$;

-- Unsubscribe lookup: names the subscription behind a token hash, nothing for unknown hashes
do $$
declare
  v_sub jsonb;
begin
  perform public.subscribe_to_status_page(tests.payments(), 'email', 'Reader@Example.com', null, null, '{}', 'confirm-extras', 'unsub-extras');
  v_sub := public.get_status_page_subscription('unsub-extras');
  assert v_sub->>'email' = 'reader@example.com';
  assert v_sub->>'type' = 'email';
  assert (v_sub->>'confirmed')::boolean = false;
  assert (v_sub->>'project_id')::uuid = tests.payments();
  perform public.confirm_status_page_subscription('confirm-extras');
  assert (public.get_status_page_subscription('unsub-extras')->>'confirmed')::boolean, 'confirmation is visible';
  perform public.unsubscribe_from_status_page('unsub-extras');
  assert public.get_status_page_subscription('unsub-extras') is null, 'gone after unsubscribing';
  assert public.get_status_page_subscription('nope') is null;
end $$;

rollback;
