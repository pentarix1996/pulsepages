-- Test-only stand-in for Supabase Vault: stores secrets in clear text.
create table if not exists @extschema@.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text,
  secret text not null,
  created_at timestamptz not null default now()
);

create or replace view @extschema@.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at from @extschema@.secrets;

create or replace function @extschema@.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret)
  on conflict (name) do update set secret = excluded.secret
  returning id into v_id;
  return v_id;
end;
$$;
