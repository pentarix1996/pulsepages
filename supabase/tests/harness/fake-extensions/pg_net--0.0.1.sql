-- Test-only stand-in for pg_net: records requests instead of sending them.
create schema if not exists net;

create table if not exists net.http_request_queue (
  id bigserial primary key,
  method text not null,
  url text not null,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer,
  created_at timestamptz not null default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into net.http_request_queue(method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, body, timeout_milliseconds)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into net.http_request_queue(method, url, headers, timeout_milliseconds)
  values ('GET', url, headers, timeout_milliseconds)
  returning id into v_id;
  return v_id;
end;
$$;
