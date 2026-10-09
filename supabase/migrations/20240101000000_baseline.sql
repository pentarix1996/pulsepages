-- ==========================================
-- Migration: Baseline schema (A-7)
-- ==========================================
-- Recreates every object the app relied on before migrations existed (formerly db_schema.sql plus the
-- objects that only lived in the production database: profiles.username, component_status_history,
-- per-user project slugs and reset_user_data()).
--
-- It is idempotent on purpose: on an existing database it only adds what is missing. Because its
-- timestamp is older than migrations already applied in production, push it with
--   supabase db push --include-all
-- A fresh database can now be built from supabase/migrations alone.

-- ------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------
create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g'))
$$;

-- ------------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  name text,
  username text,
  plan text default 'free'::text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles add column if not exists username text;
alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'profiles' and indexdef ilike '%unique%(username)%'
  ) then
    create unique index profiles_username_key on public.profiles (username) where username is not null;
  end if;
end $$;

create or replace function public.generate_unique_username(p_base text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := left(public.slugify(p_base), 32);
  v_candidate text;
begin
  if v_base is null or char_length(v_base) < 3 then
    v_base := 'user' || coalesce(nullif(v_base, ''), '');
  end if;
  v_candidate := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_candidate)) loop
    v_candidate := v_base || '-' || substr(md5(random()::text), 1, 5);
  end loop;
  return v_candidate;
end;
$$;

update public.profiles p
set username = public.generate_unique_username(coalesce(nullif(p.name, ''), split_part(u.email, '@', 1), 'user'))
from auth.users u
where u.id = p.id and (p.username is null or p.username = '');

drop policy if exists "Usuarios leen su perfil" on public.profiles;
create policy "Usuarios leen su perfil" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Usuarios editan su perfil" on public.profiles;
create policy "Usuarios editan su perfil" on public.profiles for update using (auth.uid() = id);

-- ------------------------------------------------------------------
-- Projects
-- ------------------------------------------------------------------
create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  slug text not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Slugs are unique per owner (the public URL is /status/{username}/{slug}), not globally.
alter table public.projects drop constraint if exists projects_slug_key;
create unique index if not exists projects_user_slug_key on public.projects (user_id, slug);

alter table public.projects enable row level security;
drop policy if exists "Lectura pública de proyectos" on public.projects;
create policy "Lectura pública de proyectos" on public.projects for select using (true);
drop policy if exists "Dueño puede insertar proyectos" on public.projects;
create policy "Dueño puede insertar proyectos" on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists "Dueño puede editar proyectos" on public.projects;
create policy "Dueño puede editar proyectos" on public.projects for update using (auth.uid() = user_id);
drop policy if exists "Dueño puede eliminar proyectos" on public.projects;
create policy "Dueño puede eliminar proyectos" on public.projects for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- Components
-- ------------------------------------------------------------------
create table if not exists public.components (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  status text default 'operational'::text not null
);

alter table public.components enable row level security;
drop policy if exists "Lectura pública de componentes" on public.components;
create policy "Lectura pública de componentes" on public.components for select using (true);
drop policy if exists "Modificación de componentes dueños" on public.components;
create policy "Modificación de componentes dueños" on public.components for all using (
  exists (select 1 from public.projects where projects.id = components.project_id and projects.user_id = auth.uid())
);

-- ------------------------------------------------------------------
-- Incidents and updates
-- ------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  title text not null,
  description text,
  status text not null,
  severity text not null,
  component_ids uuid[] default '{}'::uuid[],
  duration integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.incidents enable row level security;
drop policy if exists "Lectura pública de incidentes" on public.incidents;
create policy "Lectura pública de incidentes" on public.incidents for select using (true);
drop policy if exists "Modificación de incidentes dueños" on public.incidents;
create policy "Modificación de incidentes dueños" on public.incidents for all using (
  exists (select 1 from public.projects where projects.id = incidents.project_id and projects.user_id = auth.uid())
);

create table if not exists public.incident_updates (
  id uuid default gen_random_uuid() primary key,
  incident_id uuid references public.incidents(id) on delete cascade not null,
  message text not null,
  status text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.incident_updates enable row level security;
drop policy if exists "Lectura pública de updates" on public.incident_updates;
create policy "Lectura pública de updates" on public.incident_updates for select using (true);
drop policy if exists "Modificación de updates dueños" on public.incident_updates;
create policy "Modificación de updates dueños" on public.incident_updates for all using (
  exists (
    select 1 from public.incidents i
    join public.projects p on p.id = i.project_id
    where i.id = incident_updates.incident_id and p.user_id = auth.uid()
  )
);

-- ------------------------------------------------------------------
-- Component status history (used for uptime; only existed in production)
-- ------------------------------------------------------------------
create table if not exists public.component_status_history (
  id uuid default gen_random_uuid() primary key,
  component_id uuid references public.components(id) on delete cascade not null,
  status text not null,
  changed_at timestamp with time zone default timezone('utc'::text, now()) not null,
  reason text not null default 'manual',
  incident_id uuid references public.incidents(id) on delete set null
);

create index if not exists component_status_history_component_changed_idx
  on public.component_status_history (component_id, changed_at);

alter table public.component_status_history enable row level security;
drop policy if exists "Lectura pública de historial" on public.component_status_history;
create policy "Lectura pública de historial" on public.component_status_history for select using (true);
drop policy if exists "Dueños escriben historial" on public.component_status_history;
create policy "Dueños escriben historial" on public.component_status_history for insert with check (
  exists (
    select 1 from public.components c
    join public.projects p on p.id = c.project_id
    where c.id = component_status_history.component_id and p.user_id = auth.uid()
  )
);

-- ------------------------------------------------------------------
-- API keys (project scope is added by 20240424140000)
-- ------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  token_hash text not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.api_keys enable row level security;
drop policy if exists "Gestión de API Keys personales" on public.api_keys;
create policy "Gestión de API Keys personales" on public.api_keys for all using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- New users get a profile with a unique username
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, username, plan)
  values (
    new.id,
    new.raw_user_meta_data->>'name',
    public.generate_unique_username(coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))),
    'free'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------------
-- Plan limits for projects (replaced by the organization-aware version in v2)
-- ------------------------------------------------------------------
create or replace function public.enforce_project_limits()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  user_plan text;
  project_count int;
  max_projects int;
begin
  select plan into user_plan from public.profiles where id = new.user_id;
  select count(*) into project_count from public.projects where user_id = new.user_id;
  if user_plan = 'business' then
    max_projects := 999999;
  elsif user_plan = 'pro' then
    max_projects := 5;
  else
    max_projects := 1;
  end if;
  if project_count >= max_projects then
    raise exception 'Plan limit reached. Upgrade to create more projects.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_project_limit_trigger on public.projects;
create trigger check_project_limit_trigger
  before insert on public.projects
  for each row execute procedure public.enforce_project_limits();

-- ------------------------------------------------------------------
-- Danger zone RPC used by Settings (replaced in v2)
-- ------------------------------------------------------------------
create or replace function public.reset_user_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.projects where user_id = auth.uid();
end;
$$;

revoke execute on function public.reset_user_data() from public, anon;
grant execute on function public.reset_user_data() to authenticated;
