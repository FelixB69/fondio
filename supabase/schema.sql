-- Fondio — Copilote de gestion de projets IT
-- =====================================================================
-- ⚠️  RÉFÉRENCE, PAS SOURCE DE VÉRITÉ.
-- Ce fichier documente le schéma tel qu'attendu par le code. La vraie base a
-- évolué via supabase/migrations/*. Reconstruit depuis les types TS — vérifiez
-- toujours contre la base live (\d public.<table>) AVANT d'exécuter.
--
-- RÈGLES ABSOLUES (une migration passée a déjà droppé `projects` en live) :
--   • NE JAMAIS `drop table` une table réelle (projects/sessions/tasks/profiles).
--   • Pour faire évoluer le schéma : `alter table ... add column if not exists`
--     ISOLÉS, jamais de gros CREATE/DROP.
--   • Idempotent : `create table if not exists` ne recrée pas une table existante
--     (donc ne corrige PAS ses colonnes/contraintes — passez par des ALTER).
--
-- Ordre : profiles → projects → sessions → tasks (dépendances FK). RLS partout.
-- =====================================================================

-- =====================================================================
-- profiles — miroir de auth.users (rempli par trigger à l'inscription)
-- =====================================================================
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- projects — regroupe sessions, tâches et glossaire d'un projet IT.
--   project_type = genre technique (web/ai/script/mobile/api/other)
--   stage        = étape de LIVRAISON (statut manuel, découplé de l'XP)
--   glossary     = termes déjà expliqués : [{term, definition, session_id, ts}]
-- =====================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  icon text,
  color text,
  project_type text not null default 'web'
    check (project_type in ('web','ai','script','mobile','api','other')),
  stage text not null default 'cadrage'
    check (stage in ('cadrage','conception','dev','recette','prod','maintenance')),
  glossary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;
alter table public.projects alter column glossary set compression lz4;

drop policy if exists "projects_own" on public.projects;
create policy "projects_own" on public.projects
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- sessions — un fil de discussion (agent seul) ou un panel (panel_agent_ids).
-- Messages en JSONB compact :
--   [{ role, content, deliverables?, challenges?, tasks?, lexicon?,
--      artifacts?, sources?, agentId?, provider?, ts }, ...]
-- =====================================================================
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- Rattachement projet optionnel ; null si le projet est supprimé.
  project_id uuid references public.projects on delete set null,
  project_type text not null
    check (project_type in ('web','ai','script','mobile','api','other')),
  agent_id text not null,
  -- Panel multi-agents : liste d'agent_id (>= 2). Vide/absent en mode simple.
  panel_agent_ids jsonb,
  title text,
  challenger_mode boolean not null default false,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists sessions_user_idx on public.sessions (user_id, updated_at desc) where archived_at is null;
create index if not exists sessions_archived_idx on public.sessions (user_id, archived_at desc) where archived_at is not null;
create index if not exists sessions_project_idx on public.sessions (project_id);

alter table public.sessions enable row level security;
-- Compression LZ4 du blob messages (TOAST > ~2KB).
alter table public.sessions alter column messages set compression lz4;

drop policy if exists "sessions_own" on public.sessions;
create policy "sessions_own" on public.sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- tasks — board du projet. Créées à la main, converties depuis un livrable,
-- ou générées par le Chef de projet via la section `TÂCHES:`.
-- =====================================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- On garde la tâche orpheline plutôt que de la perdre si la source disparaît.
  session_id uuid references public.sessions on delete set null,
  project_id uuid references public.projects on delete set null,
  content text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  start_date date,
  due_date date,
  comments jsonb not null default '[]'::jsonb,
  -- Snapshot de l'agent source (au cas où la session disparaisse).
  source_agent_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_status_idx on public.tasks (user_id, status, created_at desc);
create index if not exists tasks_session_idx on public.tasks (session_id);
create index if not exists tasks_project_idx on public.tasks (project_id);

alter table public.tasks enable row level security;

drop policy if exists "tasks_own" on public.tasks;
create policy "tasks_own" on public.tasks
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- Migrations additionnelles (BYOK, notifications email, commentaires…) :
-- voir supabase/migrations/*.sql — à appliquer après ce fichier.
-- =====================================================================
