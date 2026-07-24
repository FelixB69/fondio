# Fondio — Guide de travail pour Claude Code

**Fondio** est un **copilote de gestion de projets IT** pour porteurs de projet **non-techniques**. L'utilisateur arrive avec un projet tech (site web, appli IA, script, appli mobile, API…) et Fondio l'accompagne de l'idée à la livraison, avec du conseil (agents spécialisés) **et** un suivi structuré (projets, jalons, tâches, agenda). Chaque terme technique employé est expliqué en langage simple.

## Stack principal

- **Framework** : Next.js 14 (App Router)
- **Langage** : TypeScript 5
- **Styling** : styles inline via tokens (`lib/design-tokens.ts`), pas de CSS modules
- **Auth + DB** : Supabase (email/password, RLS, sessions/projets/tâches en Postgres + JSONB)
- **IA** : multi-provider — **Ollama local d'abord** (Mistral/Llama3.1/Qwen), **Mistral cloud en secours**, et **BYOK** (clé perso de l'utilisateur, chiffrée). Voir `lib/llm.ts`, `lib/byok.ts`.
- **Recherche web** : Tavily (tool-calling), `lib/web-search.ts`
- **Export/artefacts** : 2e passe qui matérialise les livrables en tableaux/documents (`lib/artifacts.ts`)

## Démarrage local

```bash
npm install
cp .env.example .env.local   # remplir Supabase + (optionnel) Mistral/Tavily/BYOK

ollama serve &
ollama pull mistral                 # OLLAMA_MODEL (chat)
ollama pull qwen2.5-coder:7b        # OLLAMA_ARTIFACT_MODEL (artefacts JSON)
ollama pull llama3.1                # OLLAMA_TOOL_MODEL (recherche web — llama3 ne gère PAS les tools)

npm run dev   # http://localhost:3000
```

Le fallback cloud (Mistral) et la recherche web (Tavily) sont optionnels : sans leurs clés, l'app tourne en 100 % local et la recherche web est simplement désactivée. Voir `.env.example` pour toutes les variables.

## Architecture

### Flux utilisateur

1. **AuthScreen** — sign up / login Supabase (confirmation email obligatoire)
2. **LandingScreen** → **TypeSelector** — choix de la **nature du projet IT** (6 genres)
3. **AgentSelector** — le **roster complet** (6 agents), + toggle **Mode Panel** (2 à 4 agents qui débattent) et **Mode Challenger**
4. **ChatSession** (agent seul) ou **MultiAgentSession** (panel + synthèse) — streaming NDJSON
5. **Projets / Tâches / Agenda / Bibliothèque** — l'espace de travail autour du chat

### Couches clés

| Couche | Fichiers |
|--------|----------|
| **Écrans** | `components/*Screen.tsx`, routage via `app/(authenticated)/**` |
| **Auth** | `components/AuthScreen.tsx`, `lib/supabase/{client,server}.ts`, `middleware.ts` |
| **Chat** | `components/ChatSession.tsx` + `app/api/chat/route.ts` ; panel : `components/MultiAgentSession.tsx` + `app/api/panel-chat/route.ts` |
| **Agents & prompts** | `lib/data.ts` (6 agents IT, catégories, `buildSystemPrompt`/`buildPanelAgentPrompt`) |
| **Parsing réponses** | `lib/parse-agent-reply.ts` |
| **Projets / étapes / XP** | `lib/projects.ts` |
| **Tâches** | `lib/tasks.ts`, `lib/use-tasks.ts` (cache SWR **partagé** — ne PAS fetcher les tâches par écran) |
| **Glossaire pédagogique** | `lib/glossary.ts` |
| **LLM multi-provider** | `lib/llm.ts`, `lib/byok.ts`, `lib/web-search.ts`, `lib/artifacts.ts` |

### Genres de projet & agents (`lib/data.ts`)

- **`project_type`** (nom de colonne conservé) porte désormais un **genre IT** : `web | ai | script | mobile | api | other`. Ce n'est **pas un filtre d'agents** — c'est du **contexte** injecté dans le prompt (`PROJECT_TYPE_INSTRUCTIONS`).
- **6 agents transverses** (tous dispo pour tout projet) : `architect` (Malik), `pm` (Clara), `product` (Jade), `quality` (Rui), `devops` (Nadia), `teacher` (Sam).
  - `pm` est le **seul** à produire des **tâches** (`TÂCHES:`).
  - `teacher` est le **seul** autorisé au **cours long format** ; les autres définissent brièvement et renvoient vers lui pour l'approfondissement.

### Schéma Supabase (réel)

- **`profiles`** — miroir de `auth.users` (trigger à l'inscription).
- **`projects`** — `name`, `icon`, `color`, `project_type` (genre IT), `stage` (cycle de **livraison**), `glossary jsonb` (termes déjà expliqués).
- **`sessions`** — `project_id` (nullable), `project_type`, `agent_id`, `panel_agent_ids`, `challenger_mode`, `messages jsonb`, `archived_at`. Messages : `{ role, content, deliverables?, challenges?, tasks?, lexicon?, artifacts?, sources?, agentId?, provider?, ts }`.
- **`tasks`** — `session_id`/`project_id` (nullable), `content`, `status` (`todo|doing|done`), `priority`, `start_date`, `due_date`, `comments jsonb`, `source_agent_id`.

RLS partout (`auth.uid() = user_id`). JSONB compressé LZ4.

## Format de réponse IA

Les modèles ne produisent pas du JSON fiable → format **texte à sections**, parsé en regex avec **fallback gracieux** (`lib/parse-agent-reply.ts`) :

```
[Réponse principale en clair]

LIVRABLES:            ← chose produite (→ artefacts + convertible en tâche)
- livrable concret

TÂCHES:               ← Chef de projet uniquement (→ board, statut todo)
- action à réaliser

CHALLENGES:           ← Mode Challenger uniquement
- question difficile

LEXIQUE:              ← terme technique nouveau (→ glossaire du projet)
- terme — définition simple
```

Règles du parseur : titres tolérants au markdown (`**LIVRABLES:**`, `## …`) ; les blocs de section sont retirés **où qu'ils soient** (y compris en tête) ; ne reste que la prose. `TÂCHES` accepte l'absence d'accent.

### Volet pédagogique (anti-cours)

Un terme n'est expliqué **qu'une fois par projet** : les termes déjà dans `projects.glossary` sont **réinjectés dans le prompt** comme « déjà expliqués, ne pas redéfinir » (`buildKnownTermsInstruction`). Le LLM n'a pas de mémoire — c'est la DB qui la porte et qu'on réinjecte à chaque tour.

### Étapes = statut de livraison, PAS l'XP

`STAGES` = `Cadrage → Conception → Développement → Recette → Mise en ligne → Maintenance`. L'étape est le **statut stocké `project.stage`** (réglé à la main via le stepper), **découplé de l'XP**. L'avancement affiché = **% de tâches faites**. L'XP reste un simple indicateur d'activité.

## Conventions de code

- **Functional components** + hooks (pas de class components), PascalCase.
- TypeScript strict : typer props/retours, pas de `any`.
- Styles **inline via `lib/design-tokens.ts`** (`C.navy`, `C.border`…), responsive via `useIsMobile`.
- **Pas d'emoji dans l'UI** — utiliser le système d'icônes `components/Icon.tsx` (`IconName`).
- API routes : vérifier l'auth (`getUser()`), JSON, codes HTTP explicites (401/400/404/503).
- **Vouvoiement** dans les réponses agent, les commentaires et la doc.
- Commits : `feat|fix|refactor: …`, 1re ligne ≤ 70 car., en français.

## Pièges

### ⚠️ `supabase/schema.sql` — approximatif

Doc de référence, **pas la source de vérité** (la vraie DB a évolué au-delà). Une migration passée a déjà **droppé la table `projects` en live**. Pour toute évolution de schéma : **ALTER TABLE isolés**, jamais de gros CREATE/DROP, **ne jamais dropper une table** sans coordination. Les migrations réelles vivent dans `supabase/migrations/`.

## Commandes utiles

```bash
npm run dev        # dev (hot reload)
npm run build      # build prod
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

`npm run lint` (next lint) n'est **pas configuré** (prompt interactif) — s'appuyer sur `typecheck` + `test`.

## À retenir

1. **Copilote de projets IT pour non-techniciens** — pédagogie systématique, glossaire persistant.
2. **Auth sérieuse** — RLS partout, validation serveur.
3. **Local d'abord, cloud en secours, BYOK** — l'UI doit nommer le provider réel.
4. **Tâches via `useTasks` (SWR partagé)** — jamais de fetch de tâches par écran.
5. **Parser robuste** — format texte + fallback, jamais du JSON strict.
