-- Fondio — Conseil IA par agents spécialisés
-- Schéma minimaliste : profiles + sessions (messages stockés en JSONB compact).
-- Lancer dans le SQL editor Supabase. RLS activé sur toutes les tables.

-- =====================================================================
-- profiles
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
-- sessions — une session = un fil de discussion avec un agent.
-- Les messages sont stockés en JSONB compact :
--   [{ "role": "user"|"assistant", "content": "...",
--      "deliverables": ["..."], "challenges": ["..."], "ts": "ISO" }, ...]
-- =====================================================================
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  project_type text not null check (project_type in ('perso', 'pro')),
  agent_id text not null,
  title text,
  challenger_mode boolean not null default false,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists sessions_user_idx on public.sessions (user_id, updated_at desc) where archived_at is null;
create index if not exists sessions_archived_idx on public.sessions (user_id, archived_at desc) where archived_at is not null;

alter table public.sessions enable row level security;

drop policy if exists "sessions_own" on public.sessions;
create policy "sessions_own" on public.sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Compression LZ4 sur le blob messages pour les longues conversations (TOAST > ~2KB).
alter table public.sessions alter column messages set compression lz4;

-- =====================================================================
-- tasks — to-do list. Une tâche peut être créée à la main ou convertie
-- depuis un livrable produit par un agent.
-- =====================================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- session_id devient null si la session source est supprimée — on garde
  -- la tâche orpheline plutôt que de la perdre.
  session_id uuid references public.sessions on delete set null,
  content text not null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  -- Snapshot de l'agent source (au cas où la session disparaisse).
  source_agent_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_status_idx on public.tasks (user_id, status, created_at desc);
create index if not exists tasks_session_idx on public.tasks (session_id);

alter table public.tasks enable row level security;

drop policy if exists "tasks_own" on public.tasks;
create policy "tasks_own" on public.tasks
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- Drop des anciennes tables si elles existent (migration depuis l'ancien schéma).
-- =====================================================================
drop table if exists public.documents cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.projects cascade;
