# Fondio

**Copilote de gestion de projets IT** pour porteurs de projet **non-techniques**. Vous arrivez avec un projet tech (site web, appli IA, script, appli mobile, API…) et Fondio vous accompagne de l'idée à la livraison : conseil par agents spécialisés **et** suivi structuré (projets, étapes, tâches, agenda). Chaque terme technique est expliqué en langage simple.

Stack : Next.js 14 (App Router), TypeScript, Supabase (auth + persistance), IA **locale d'abord** (Ollama) avec **secours cloud** (Mistral) et **BYOK**.

## Démarrage en 4 étapes

### 1. Dépendances

```bash
npm install
cp .env.example .env.local
```

`.env.local` — Supabase obligatoire, le reste optionnel (voir `.env.example`) :
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral
# Optionnel : MISTRAL_API_KEY (secours cloud), TAVILY_API_KEY (recherche web),
# API_KEY_ENCRYPTION_SECRET (BYOK)
```

### 2. Supabase

1. Créer un projet sur [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email** : *Confirm email* activé.
3. **URL Configuration → Redirect URLs** : ajouter `http://localhost:3000/auth/callback`.
4. **SQL editor** : exécuter [supabase/schema.sql](supabase/schema.sql), puis les migrations de [supabase/migrations/](supabase/migrations/). ⚠️ `schema.sql` est une **référence approximative** — préférez des `ALTER TABLE` isolés, ne droppez jamais de table en prod.
5. **Settings → API** : copier `Project URL` et `anon public` dans `.env.local`.

### 3. Ollama (IA locale)

```bash
brew install ollama
ollama serve
ollama pull mistral                 # chat
ollama pull qwen2.5-coder:7b        # artefacts structurés
ollama pull llama3.1                # recherche web (tool-calling ; llama3 ne suffit pas)
```

Sans Ollama joignable, l'app bascule sur Mistral cloud si `MISTRAL_API_KEY` est fournie.

### 4. Lancer

```bash
npm run dev   # http://localhost:3000
```

## Flow utilisateur

1. **Auth** — login / sign up Supabase.
2. **TypeSelector** — nature du projet IT (6 genres).
3. **AgentSelector** — roster complet + **Mode Panel** (2–4 agents qui débattent) et **Mode Challenger**.
4. **ChatSession** / **MultiAgentSession** — chat en streaming ; livrables, tâches, questions difficiles et lexique s'affichent sous les réponses.
5. **Projets / Tâches / Agenda / Bibliothèque** — l'espace de travail autour du chat.

## Genres de projet

🌐 Site / app web · 🤖 Projet IA · 🧩 Script / automatisation · 📱 Application mobile · 🔌 API / backend / intégration · 🛠️ Autre projet tech

*(en UI, ce sont des icônes — pas d'emoji.)* Le genre n'est pas un filtre d'agents : il enrichit le contexte technique injecté dans le prompt.

## Agents

Tous transverses (dispo pour tout projet), définis dans [lib/data.ts](lib/data.ts) :

- 🏗️ **Architecte technique** (Malik) — stack, architecture, découpage, dette
- 🗂️ **Chef de projet** (Clara) — cadrage, planning, jalons ; **seul à créer des tâches**
- 🎨 **Conseiller produit / UX** (Jade) — parcours, priorisation, MVP
- 🐛 **Debug & qualité** (Rui) — tests, revue, bugs, dette
- 🚀 **Mise en prod & déploiement** (Nadia) — hébergement, CI/CD, monitoring
- 🎓 **Formateur** (Sam) — répond aux questions frontales (« c'est quoi une API ? ») ; **seul à faire le cours long format**

## Format de réponse

Format texte à sections, parsé en regex avec **fallback gracieux** ([lib/parse-agent-reply.ts](lib/parse-agent-reply.ts)) :

```
[Réponse principale]

LIVRABLES:      → chose produite (matérialisée en artefacts, convertible en tâche)
TÂCHES:         → Chef de projet uniquement (alimente le board, statut todo)
CHALLENGES:     → Mode Challenger uniquement
LEXIQUE:        → terme technique nouveau (alimente le glossaire du projet)
```

**Pédagogie sans redite** : un terme n'est expliqué qu'une fois par projet — les termes déjà dans `projects.glossary` sont réinjectés dans le prompt comme « déjà connus ».

## Suivi de projet

Un **projet** regroupe des sessions, des tâches et un glossaire. Son **étape** suit un cycle de **livraison** (`Cadrage → Conception → Développement → Recette → Mise en ligne → Maintenance`), réglée manuellement ; l'avancement affiché = **% de tâches faites**.

## Architecture

| Couche | Code |
| --- | --- |
| Écrans | `components/*Screen.tsx`, `app/(authenticated)/**` |
| Auth | `@supabase/ssr` — [lib/supabase/](lib/supabase/), [middleware.ts](middleware.ts) |
| Chat | [app/api/chat/route.ts](app/api/chat/route.ts), panel : [app/api/panel-chat/route.ts](app/api/panel-chat/route.ts) |
| Agents / prompts | [lib/data.ts](lib/data.ts) |
| Projets / tâches / glossaire | [lib/projects.ts](lib/projects.ts), [lib/use-tasks.ts](lib/use-tasks.ts), [lib/glossary.ts](lib/glossary.ts) |
| LLM multi-provider | [lib/llm.ts](lib/llm.ts), [lib/byok.ts](lib/byok.ts), [lib/web-search.ts](lib/web-search.ts) |

## Auth — protection

- Confirmation email obligatoire ; `/auth/callback` consomme le code PKCE.
- [middleware.ts](middleware.ts) rafraîchit la session sur chaque requête.
- Les routes API rejettent toute requête non authentifiée (401).
- RLS Postgres : tables inaccessibles sans `auth.uid() = user_id`.

## Limitations connues

- Recherche web nécessite une clé Tavily et un modèle qui gère le tool-calling.
- Pas de page dédiée de changement de mot de passe (le reset ouvre la home).
