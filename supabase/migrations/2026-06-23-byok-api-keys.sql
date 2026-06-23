-- BYOK : clés API personnelles + provider préféré.
-- Isolé du schema.sql principal — à lancer manuellement dans le SQL editor
-- Supabase (ou via la CLI). Ne PAS fusionner dans schema.sql tel quel : on
-- garde une trace par migration depuis l'incident de drop de "projects".

-- =====================================================================
-- user_api_keys — une clé chiffrée par (utilisateur, fournisseur).
-- Le chiffrement (AES-256-GCM) se fait côté Node, PAS en SQL : la colonne ne
-- contient qu'un texte déjà opaque (base64 de iv + ciphertext + authTag).
-- =====================================================================
create table if not exists public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'mistral_byok')),
  encrypted_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.user_api_keys enable row level security;

drop policy if exists "user_api_keys_own" on public.user_api_keys;
create policy "user_api_keys_own" on public.user_api_keys
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- profiles.preferred_ai_provider — null = comportement actuel (Local/Mistral
-- Fondio). Sinon, un des 4 fournisseurs BYOK devient le tier "cloud" par défaut.
-- =====================================================================
alter table public.profiles
  add column if not exists preferred_ai_provider text
  check (preferred_ai_provider in ('anthropic', 'openai', 'google', 'mistral_byok'));
