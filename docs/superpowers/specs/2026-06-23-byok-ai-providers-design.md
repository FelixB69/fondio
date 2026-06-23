# BYOK — Connecter sa propre clé API (Anthropic, OpenAI, Google, Mistral)

**Date** : 2026-06-23
**Statut** : Approuvé, prêt pour plan d'implémentation

## Contexte

Fondio utilise aujourd'hui deux providers : Ollama (local) avec fallback automatique vers Mistral Cloud (clé API Fondio, tier gratuit). Certains utilisateurs ont déjà un abonnement payant à une API IA (Anthropic, OpenAI, Google, ou Mistral) et veulent que Fondio utilise leur propre clé plutôt que les modèles fournis par Fondio — pour avoir un modèle plus puissant, ou pour ne pas dépendre du tier gratuit Mistral.

**Clarification importante** : il ne s'agit pas du protocole MCP (Model Context Protocol) ni d'utiliser un forfait Claude.ai Pro/ChatGPT Plus — ces abonnements grand public ne sont pas accessibles par API à des apps tierces. Il s'agit de **BYOK (Bring Your Own Key)** : l'utilisateur fournit une clé API personnelle (Anthropic API, OpenAI API, Google AI API, Mistral API), facturée à l'usage par le fournisseur, pas par Fondio.

## Objectif

Permettre à un utilisateur de connecter sa propre clé API à un des 4 fournisseurs supportés (Anthropic, OpenAI, Google, Mistral), de la définir comme provider préféré, et que Fondio l'utilise pour le chat (avec streaming), la mise en forme des livrables, et la recherche web (tool-calling) — sur **toutes ses conversations**, avec repli automatique vers Local/Mistral Fondio en cas d'échec.

## Modèle de données

### Nouvelle table `user_api_keys`

```sql
create table user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'mistral_byok')),
  encrypted_key bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table user_api_keys enable row level security;

create policy "users manage their own api keys"
  on user_api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Chiffrement via `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) avec un secret stocké dans la variable d'env serveur `API_KEY_ENCRYPTION_SECRET` (jamais exposée au client, jamais commitée). Le déchiffrement n'a lieu que côté serveur (route handler Node), juste avant l'appel à l'API du fournisseur. La clé en clair n'est jamais renvoyée au client après l'enregistrement initial — l'UI affiche seulement un statut "configurée" + les 4 derniers caractères.

### `profiles.preferred_ai_provider`

```sql
alter table profiles add column preferred_ai_provider text
  check (preferred_ai_provider in ('anthropic', 'openai', 'google', 'mistral_byok'));
```

`null` par défaut = comportement actuel (Local/Mistral Fondio). Une valeur non-null active le repli BYOK pour toutes les conversations de l'utilisateur.

**⚠️ Application au schéma** : suivre la règle du projet — ALTER TABLE isolés, jamais de DROP/CREATE massif sur `schema.sql` directement. Ajouter ces deux changements comme migrations isolées.

## Architecture provider (`lib/llm.ts`)

### Nouveaux adaptateurs

Même forme que les adaptateurs existants (`callOllamaJson`/`callMistralJson`, `callOllamaTools`/`callMistralTools`, `ollamaStreamToText`/`mistralStreamToText`), un trio (`Json`, `Stream`, `Tools`) par fournisseur :

- `callAnthropicJson/Stream/Tools` — Anthropic Messages API (`/v1/messages`, header `x-api-key` + `anthropic-version`, format de tool-calling propre à Anthropic avec blocs `tool_use`/`tool_result`).
- `callOpenAIJson/Stream/Tools` — OpenAI Chat Completions API (déjà très proche du format Mistral existant, peut réutiliser `toMistralToolMessages`-style).
- `callGoogleJson/Stream/Tools` — Google Generative AI API (`generateContent`/`streamGenerateContent`, format de message et de tool-calling différent — `contents`/`parts`, `functionCall`/`functionResponse`).
- `callMistralByokJson/Stream/Tools` — réutilise le code Mistral existant, juste avec la clé utilisateur à la place de `MISTRAL_API_KEY`.

`LLMProvider` devient `"local" | "cloud" | "byok"`. `LLMResult.provider` et `.providerLabel` reflètent le fournisseur réel utilisé pour CE tour (ex. `"Claude Sonnet · votre clé"`), pas seulement la préférence demandée — important pour le fallback silencieux.

### Résolution / fallback

Chaque fonction publique (`callChatModel`, `callChatModelStream`, `callModelWithTools`) accepte le `preferred_ai_provider` de l'utilisateur (chargé depuis `profiles` par l'appelant, typiquement `app/api/chat/route.ts`) et applique :

1. **BYOK** si préférence définie ET clé présente → tente le fournisseur choisi.
2. Échec BYOK (clé invalide/401, quota/429, panne fournisseur/5xx, timeout) → **Local** (Ollama), comme le comportement actuel.
3. Échec Local → **Mistral Fondio** (cloud), comme le comportement actuel.
4. `describeLLMError` étend ses messages pour préciser quel fournisseur BYOK a échoué et pourquoi (ex. `"Clé Anthropic invalide ou expirée — vérifiez-la dans Paramètres."`), pour que l'utilisateur sache quoi corriger.

Pas de fallback "silencieux" déguisé : `providerLabel` affiché dans l'UI dit toujours la vérité sur qui a répondu à ce tour précis.

### Modèles par défaut (`lib/models.ts`)

Un modèle fixe par fournisseur BYOK pour la v1 (pas de sélecteur) :

| Fournisseur | Modèle par défaut (chat + artifact) |
|---|---|
| Anthropic | `claude-sonnet-4-5` (ou dernier Sonnet stable) |
| OpenAI | `gpt-4o-mini` |
| Google | `gemini-2.0-flash` |
| Mistral (BYOK) | `mistral-small-latest` (même modèle que le Mistral Fondio) |

Ajout des règles d'embellissement correspondantes dans `PRETTY_RULES` et `providerPrivacyNote` pour le cas `"byok"` (ex. *"Appel direct à l'API {Fournisseur} avec votre clé personnelle — facturé par eux, pas par Fondio."*).

### Tool-calling pour la recherche web

`gatherWebContext` / le tool-loop dans `app/api/chat/route.ts` doivent accepter le provider BYOK comme n'importe quel autre — chaque adaptateur `*Tools` traduit le format normalisé `ToolLoopMessage`/`ToolDef` déjà existant vers/depuis son format propre, exactement comme `toOllamaToolMessages`/`toMistralToolMessages` le font aujourd'hui.

## UI/UX

### `AccountScreen.tsx`

Nouvelle `SectionCard` "Votre IA personnelle", avec une ligne par fournisseur (réutilise le style `Field`/`SubSection` existant) :

- Champ clé (type password, jamais réaffiché après enregistrement — juste `•••• sk-ant-...wXyz`).
- Bouton "Valider et enregistrer" : fait un appel test minimal à l'API du fournisseur avant d'écrire en base ; échec → message d'erreur inline, rien n'est stocké.
- Bouton "Supprimer" si une clé existe déjà.
- Sélecteur (radio ou liste) "Utiliser par défaut" : choisit lequel des fournisseurs configurés devient `preferred_ai_provider`, ou "Aucun (revenir à Local/Mistral Fondio)".

Nouvelle route API `app/api/account/api-keys/route.ts` (POST pour enregistrer + valider, DELETE pour retirer, et mise à jour de `preferred_ai_provider` séparément ou dans le même body) — vérifie l'auth via `getUser()` comme toutes les routes existantes.

### `ModelSelector.tsx`

Pas de 3e option séparée dans le popover : l'entrée "Cloud" existante se renomme et se redécore dynamiquement selon `preferred_ai_provider` :

- Si non configuré → reste "Mistral Cloud" (comportement actuel, inchangé).
- Si configuré (ex. Anthropic) → devient "Claude Sonnet · votre clé" avec sa propre `privacyNote`.

Le toggle Local/Cloud par session reste identique dans son fonctionnement — "Cloud" pointe juste vers la préférence globale de l'utilisateur au lieu d'être toujours Mistral Fondio.

`/api/ollama-status` (ou une extension de cette route) renvoie aussi l'état BYOK : fournisseur préféré, modèle réel, et si la clé est valide/configurée, pour alimenter `ModelSelector` sans appel supplémentaire.

## Sécurité

- Clé jamais transmise en clair après l'enregistrement initial (POST one-way) ; jamais loguée (vérifier qu'aucun `console.log`/`Error` n'inclue la clé brute — les messages d'erreur des adaptateurs doivent tronquer/exclure tout header `Authorization`/`x-api-key`).
- Validation systématique à la saisie (appel test) pour éviter de stocker une clé invalide silencieusement.
- RLS stricte sur `user_api_keys` : aucun accès cross-utilisateur possible.
- Respect de la règle du projet : auth vérifiée (`getUser()`) sur toute nouvelle route API, JSON en retour, codes HTTP explicites.

## Hors scope (v1)

- Sélection fine du modèle par fournisseur (Opus vs Sonnet vs Haiku, GPT-4o vs 4o-mini, etc.) — un seul modèle par défaut par fournisseur.
- Suivi de consommation/coût de la clé personnelle dans l'UI Fondio.
- Rotation ou expiration automatique des clés.
- Tout mécanisme MCP réel (Fondio comme serveur MCP exposé à Claude Desktop ou autre client MCP) — piste explorée puis écartée, le besoin réel était BYOK.

## Plan de test (aperçu, détaillé dans le plan d'implémentation)

- Adaptateurs : tests unitaires de traduction de messages (normalisé ↔ format Anthropic/OpenAI/Google) avec mocks de réponse API, y compris erreurs 401/429/5xx.
- Fallback : test que BYOK→Local→Mistral Fondio s'enchaîne correctement et que `providerLabel` reflète toujours le fournisseur réel utilisé.
- Chiffrement : test que la clé stockée n'est jamais lisible sans le secret serveur, et qu'elle n'apparaît dans aucune réponse API après écriture.
- UI : validation de clé invalide affiche une erreur sans rien enregistrer ; changement de préférence se reflète immédiatement dans `ModelSelector`.
