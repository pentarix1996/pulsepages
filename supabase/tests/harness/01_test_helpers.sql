-- Helpers for SQL tests (impersonation). Installed after all migrations.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.as_user(p_user uuid)
returns void
language plpgsql
as $$
declare
  v_email text;
begin
  execute 'reset role';
  select email into v_email from auth.users where id = p_user;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'email', v_email)::text, true);
  perform set_config('request.headers', '', true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('request.headers', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.as_service()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '', true);
  execute 'set local role service_role';
end;
$$;

-- Service role acting for an API key (what the public API does): guards apply as for dashboard users.
create or replace function tests.as_api_key(p_key text default 'api_key:test')
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', json_build_object('x-upvane-actor', p_key)::text, true);
  execute 'set local role service_role';
end;
$$;

create or replace function tests.as_postgres()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Ids used across tests
create or replace function tests.alice() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
create or replace function tests.bob() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000b1'::uuid $$;
create or replace function tests.mallory() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000c1'::uuid $$;
create or replace function tests.payments() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000aa01'::uuid $$;
create or replace function tests.blog() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000bb01'::uuid $$;
create or replace function tests.gateway() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000c0001'::uuid $$;
create or replace function tests.payments_api() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000c0002'::uuid $$;
create or replace function tests.webhooks() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000c0003'::uuid $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
