-- Dismissals des notifications d'échéance de tâches (cloche in-app). Isolé du
-- schema.sql principal — à lancer manuellement dans le SQL editor Supabase.
-- Clé (user_id, task_id, due_date) : si la due_date d'une tâche change après
-- un dismiss, l'ancienne ligne ne correspond plus à rien → la notification
-- réapparaît automatiquement, sans job de nettoyage.

create table if not exists public.task_notification_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  task_id uuid not null references public.tasks on delete cascade,
  due_date date not null,
  dismissed_at timestamptz not null default now(),
  unique (user_id, task_id, due_date)
);

alter table public.task_notification_dismissals enable row level security;

drop policy if exists "task_notification_dismissals_own" on public.task_notification_dismissals;
create policy "task_notification_dismissals_own" on public.task_notification_dismissals
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
