-- Commentaires horodatés par tâche, stockés en JSONB (pattern sessions.messages).
-- Isolé du schema.sql principal — à lancer manuellement dans le SQL editor
-- Supabase (ou via la CLI). Ne PAS fusionner dans schema.sql tel quel : on
-- garde une trace par migration depuis l'incident de drop de "projects".

alter table public.tasks
  add column if not exists comments jsonb not null default '[]'::jsonb;
