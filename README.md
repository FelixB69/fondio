# Fondio

App de conseil IA par agents spécialisés (perso & pro). Stack : Next.js 14 (App Router), TypeScript, Tailwind, Supabase (auth + persistance des sessions), Ollama (modèles locaux — Llama3 par défaut).

L'utilisateur choisit un type de projet (🌱 perso / 💼 pro), sélectionne un agent conseiller, et démarre une session structurée. L'agent répond en français avec un texte principal, un bloc **Livrables** (quand quelque chose de concret est produit) et, si le **Mode Challenger** est activé, un bloc **Questions difficiles**.

## Démarrage en 4 étapes

### 1. Dépendances

```bash
npm install
cp .env.example .env.local   # à créer si absent
```

`.env.local` :
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### 2. Supabase

1. Créer un projet sur [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email** : *Confirm email* doit rester **activé** (la signup envoie un lien, l'utilisateur le clique, atterrit sur `/auth/callback` qui finalise la session).
3. **Authentication → URL Configuration → Redirect URLs** : ajouter `http://localhost:3000/auth/callback` (et l'URL de prod si vous déployez).
4. **SQL editor** : coller et exécuter [supabase/schema.sql](supabase/schema.sql). Cela crée `profiles` et `sessions`, active RLS, et drop les anciennes tables si vous migrez depuis l'ancien schéma.
5. **Settings → API** : copier `Project URL` et `anon public` key dans `.env.local`.

### 3. Ollama

```bash
brew install ollama       # si pas déjà installé
ollama serve              # daemon sur http://localhost:11434
ollama pull llama3        # ou : mistral, llama3.1:8b, qwen2.5...
```

Vérifiez le modèle disponible :
```bash
ollama list
```

Si vous utilisez un autre tag, ajustez `OLLAMA_MODEL` dans `.env.local`.

### 4. Lancer

```bash
npm run dev
```

→ http://localhost:3000

## Flow utilisateur

1. **Auth** — login / sign up via Supabase email/password.
2. **TypeSelector** — choix Perso (🌱) ou Pro (💼).
3. **AgentSelector** — grille des 4 agents disponibles selon le type.
4. **ChatSession** — chat avec l'agent. Toggle **Mode Challenger** dans le header pour pousser l'agent à challenger les hypothèses.
5. **Sidebar** — historique de toutes les sessions, cliquables pour reprendre.

## Agents

### 💼 Pro
- 🧠 **Stratège** — vision long terme, positionnement, modèle économique
- 📊 **Analyste marché** — TAM/SAM/SOM, concurrents, tendances, pricing
- 💰 **Conseiller financier** — projections, unit economics, structure de coûts
- ⚙️ **CTO de poche** — stack tech, architecture, roadmap produit, dette technique

### 🌱 Perso
- 🎯 **Coach de projet** — clarification d'objectif, motivation, structure d'action
- 🚀 **Mentor lancement** — MVP, premiers clients, side project → revenu
- ✍️ **Conseiller créatif** — contenu, marque perso, audience
- 🔄 **Guide reconversion** — compétences transférables, plan de transition, réseau

Chaque agent a son `systemPrompt` dédié dans [lib/data.ts](lib/data.ts). Le mode Challenger ajoute un bloc d'instructions supplémentaire au prompt système avant l'appel.

## Format de réponse

Llama3 n'est pas fiable en JSON strict. On lui demande à la place un format texte avec sections marquées :

```
[Réponse principale en clair, 2-5 paragraphes max]

LIVRABLES:
- premier livrable concret
- deuxième livrable

CHALLENGES:                    ← uniquement si Mode Challenger ON
- question difficile qui challenge une hypothèse
- angle mort potentiel
```

La route [app/api/chat/route.ts](app/api/chat/route.ts) parse cette structure en regex. **Triple fallback** :
1. Si la réponse contient un objet JSON valide avec `message`, on l'utilise tel quel.
2. Sinon on extrait les sections `LIVRABLES:` et `CHALLENGES:` en regex.
3. Sinon, le texte brut devient le `content` (rien n'est perdu).

## Architecture

| Couche | Code |
| --- | --- |
| Routage écrans | `useState` dans [components/App.tsx](components/App.tsx) |
| Auth | Supabase email/password — [components/AuthScreen.tsx](components/AuthScreen.tsx) |
| Persistance | `@supabase/ssr` — [lib/supabase/client.ts](lib/supabase/client.ts) (browser), [lib/supabase/server.ts](lib/supabase/server.ts) (route) |
| Agents IA | Ollama HTTP (`/api/chat`) — [app/api/chat/route.ts](app/api/chat/route.ts), prompts dans [lib/data.ts](lib/data.ts) |
| Schéma | RLS partout, FK en cascade — [supabase/schema.sql](supabase/schema.sql) |

### Schéma Supabase compact

Une seule table `sessions` :
- `id`, `user_id`, `project_type` (`'perso' | 'pro'`), `agent_id`, `title`, `challenger_mode`
- `messages jsonb` — un tableau d'objets `{ role, content, deliverables?, challenges?, ts }`. Compressé LZ4 par Postgres pour les longs fils.
- `created_at`, `updated_at`

Pas de tables séparées pour les messages — tout vit dans le JSONB de la session, ce qui évite multi-inserts et requêtes N+1 sur le chargement.

## Variables d'environnement

| Variable | Défaut | Usage |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Project URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | anon public key Supabase |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Endpoint daemon Ollama |
| `OLLAMA_MODEL` | `llama3` | Tag exact du modèle (doit être `pull`é) |

## Auth — protection mandatory

- Confirmation email obligatoire : impossible de créer un compte avec un email bidon (le lien doit être cliqué).
- [middleware.ts](middleware.ts) rafraîchit la session Supabase sur chaque requête (pattern `@supabase/ssr`).
- L'API `/api/chat` rejette toute requête non-authentifiée (401), même via curl.
- RLS Postgres : la table `sessions` est inaccessible sans `auth.uid() = user_id`.
- Page `/auth/callback` ([app/auth/callback/route.ts](app/auth/callback/route.ts)) consomme le code PKCE des liens email (signup + reset password).

## Limitations connues

- Pas de streaming — la réponse arrive en bloc une fois Ollama terminé (peut être lent sur Llama3 8B selon la machine).
- Llama3 produit parfois du texte qui ne match pas le format → le fallback affiche le contenu brut sans bloc Livrables/Challenges. Acceptable pour un proto.
- Pas de page dédiée pour mettre à jour le mot de passe après reset (le callback ouvre la home, mais il faudrait un formulaire de changement).
- Pas d'export PDF/Markdown des sessions pour le moment.
