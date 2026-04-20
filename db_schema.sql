-- ==========================================
-- SCRIPT DE INICIALIZACIÓN: PULSEPAGES DB
-- ==========================================
-- Pega este código completo en el SQL Editor de tu panel de Supabase y dale a "Run"

-- 1. Tabla de Perfiles (Extendiendo auth.users nativo)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  name text,
  plan text default 'free'::text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;
create policy "Usuarios leen su perfil" on profiles for select using (auth.uid() = id);
create policy "Usuarios editan su perfil" on profiles for update using (auth.uid() = id);


-- 2. Tabla de Proyectos
create table public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  slug text unique not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.projects enable row level security;
create policy "Lectura pública de proyectos" on projects for select using (true);
create policy "Dueño puede insertar proyectos" on projects for insert with check (auth.uid() = user_id);
create policy "Dueño puede editar proyectos" on projects for update using (auth.uid() = user_id);
create policy "Dueño puede eliminar proyectos" on projects for delete using (auth.uid() = user_id);


-- 3. Tabla de Componentes
create table public.components (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  status text default 'operational'::text not null
);

alter table public.components enable row level security;
create policy "Lectura pública de componentes" on components for select using (true);
create policy "Modificación de componentes dueños" on components for all using (
  exists (select 1 from public.projects where projects.id = components.project_id and projects.user_id = auth.uid())
);


-- 4. Tabla de Incidentes
create table public.incidents (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  title text not null,
  description text,
  status text not null,
  severity text not null,
  component_ids uuid[] default '{}'::uuid[], -- Array para guardar los IDs afectados
  duration integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.incidents enable row level security;
create policy "Lectura pública de incidentes" on incidents for select using (true);
create policy "Modificación de incidentes dueños" on incidents for all using (
  exists (select 1 from public.projects where projects.id = incidents.project_id and projects.user_id = auth.uid())
);


-- 5. Tabla de Updates del Incidente (Historial)
create table public.incident_updates (
  id uuid default gen_random_uuid() primary key,
  incident_id uuid references public.incidents(id) on delete cascade not null,
  message text not null,
  status text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.incident_updates enable row level security;
create policy "Lectura pública de updates" on incident_updates for select using (true);
create policy "Modificación de updates dueños" on incident_updates for all using (
  exists (
    select 1 from public.incidents i 
    join public.projects p on p.id = i.project_id 
    where i.id = incident_updates.incident_id and p.user_id = auth.uid()
  )
);


-- 6. Tabla de API Keys
create table public.api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  token_hash text not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.api_keys enable row level security;
create policy "Gestión de API Keys personales" on api_keys for all using (auth.uid() = user_id);


-- 7. Triggers de Automatización 
-- Este trigger creará automáticamente el perfil del usuario cuando se registre con email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, plan)
  values (new.id, new.raw_user_meta_data->>'name', 'free');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ==========================================
-- 8. Validaciones y Límites de Negocio (Monetización)
-- ==========================================

-- Función para validar el límite de Proyectos según el Plan
create or replace function public.enforce_project_limits()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  user_plan text;
  project_count int;
  max_projects int;
begin
  -- Obtener el plan del usuario
  select plan into user_plan from public.profiles where id = new.user_id;
  
  -- Contar cuántos proyectos tiene ya
  select count(*) into project_count from public.projects where user_id = new.user_id;
  
  -- Definir el máximo según el plan
  if user_plan = 'business' then
    max_projects := 999999;
  elsif user_plan = 'pro' then
    max_projects := 5;
  else
    max_projects := 1;
  end if;

  -- Bloquear si excede
  if project_count >= max_projects then
    raise exception 'Plan limit reached. Upgrade to create more projects.';
  end if;
  
  return new;
end;
$$;

-- Atar el Trigger a la tabla de Proyectos
drop trigger if exists check_project_limit_trigger on public.projects;
create trigger check_project_limit_trigger
  before insert on public.projects
  for each row execute procedure public.enforce_project_limits();
