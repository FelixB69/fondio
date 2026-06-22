# Fondio — Guide de travail pour Claude Code

**Fondio** est une application de conseil IA avec agents spécialisés. Elle permet aux utilisateurs de créer des sessions de chat structurées avec différents conseillers (Stratège, Analyste marché, Coach de projet, etc.) pour des besoins professionnels ou personnels.

## Stack principal

- **Framework** : Next.js 14 (App Router)
- **Langage** : TypeScript 5
- **Styling** : Tailwind CSS
- **Auth + DB** : Supabase (email/password auth, RLS, JSONB sessions)
- **IA** : Ollama (modèles locaux : Llama3, Mistral, Qwen, etc.)
- **Export** : PDFKit, XLSX, Docx pour générer des documents

## Démarrage local

```bash
npm install

# Créer .env.local avec les clés Supabase
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3

# Ollama doit tourner en daemon
ollama serve &
ollama pull llama3

# Démarrer le serveur de dev
npm run dev
```

http://localhost:3000

## Architecture

### Flux utilisateur

1. **AuthScreen** — sign up / login via Supabase email
2. **LandingScreen** — page d'accueil avec présentation
3. **ProjectPickerScreen** — choix Perso (🌱) ou Pro (💼)
4. **AgentSelector** — grille de 4 agents selon le type
5. **ChatSession** — chat avec l'agent + toggle Mode Challenger
6. **Sidebar** — historique des sessions

### Couches clés

| Couche | Fichiers |
|--------|----------|
| **App Router** | `components/App.tsx` (gestion d'état principal via useState) |
| **Écrans** | `components/*Screen.tsx` |
| **Auth** | `components/AuthScreen.tsx`, `lib/supabase/client.ts`, `lib/supabase/server.ts` |
| **Chat** | `components/ChatSession.tsx`, `app/api/chat/route.ts` |
| **Agents** | `lib/data.ts` (4 agents × 2 types = 8 systemPrompts) |
| **Session** | Supabase table `sessions` (JSONB messages avec RLS) |

### Schéma Supabase

Une seule table `sessions` par design :
- `id` (UUID primary key)
- `user_id` (FK → `auth.users`, cascade delete)
- `project_type` ('perso' | 'pro')
- `agent_id` (string, ex. 'strategist')
- `title` (string)
- `challenger_mode` (boolean)
- `messages` (JSONB array of `{ role, content, deliverables?, challenges?, ts }`)
- `created_at`, `updated_at` (timestamps)

**Avantage** : tout vit dans un seul JSONB, pas de N+1 sur les messages.
**Important** : Postgres compresse les JSONB longs en LZ4 automatiquement.

## Conventions de code

### Composants React

- Utiliser des **functional components** avec hooks (React 18)
- **Pas de class components**
- Préférer `useState` pour l'état local, Supabase pour la persistance
- Noms en PascalCase (ex. `ChatSession.tsx`)

### TypeScript

- Typer **tous les props** et retours de fonction
- Utiliser des **types explicites**, pas `any`
- Enums pour les constantes (ex. `project_type`, `agent_id`)

### Styling

- **Tailwind CSS** uniquement — pas de CSS modules
- Préférer les utilitaires Tailwind (`flex`, `gap-4`) plutôt que du CSS custom
- Responsive d'abord (`sm:`, `md:`, `lg:`)

### API Routes

- Implémenter la vérification d'auth (appel `getUser()` depuis `lib/supabase/server.ts`)
- Toujours retourner du JSON (type de réponse `application/json`)
- Gérer les erreurs avec codes HTTP explicites (401, 400, 500)

### Messages Commit

- Format court : `feat: ...`, `fix: ...`, `refactor: ...`
- Première ligne ≤ 70 caractères
- En français si le code est francisé

## Points clés de la conception

### Authentification

- **Supabase Auth** avec confirmation email obligatoire
- `middleware.ts` rafraîchit la session sur chaque requête (pattern `@supabase/ssr`)
- `/auth/callback` consomme le code PKCE des liens email
- RLS Postgres : table `sessions` inaccessible sans `auth.uid() = user_id`

### Format de réponse IA

Llama3 ne génère pas du JSON fiable, donc on demande un format texte :

```
[Réponse principale en clair, 2-5 paragraphes max]

LIVRABLES:
- premier livrable concret
- deuxième livrable

CHALLENGES:                    ← seulement si Mode Challenger ON
- question difficile
- angle mort potentiel
```

Le parser dans `app/api/chat/route.ts` a un triple fallback :
1. Cherchez un JSON valide avec champ `message`
2. Sinon extrayez les sections `LIVRABLES:` et `CHALLENGES:` en regex
3. Sinon, affichez le texte brut tel quel

## Pièges et limites

### ⚠️ schema.sql — LIRE AVANT TOUTE MODIF

Le fichier `supabase/schema.sql` est approximatif. **À l'époque d'une migration antérieure, il a droppé la table `projects` en live.** Avant de modifier le schéma :
- Lisez le commit d'origine pour comprendre le contexte
- Utilisez **des ALTER TABLE isolés** plutôt que des CREATE TABLE massifs
- **Ne droppez jamais une table en production** sans coordination

### Limitations actuelles

- **Pas de streaming** — la réponse arrive en bloc quand Ollama a fini
- **Ollama local** — performance dépend de votre machine (Llama3 8B peut être lent)
- **Pas de changement de password** — reset envoie un lien, mais pas de formulaire dédiée pour mettre à jour
- **Pas d'export PDF/Markdown** — les dépendances existent (`pdfkit`, `docx`) mais pas d'UI

## Commandes utiles

```bash
npm run dev       # Démarrage dev (hot reload)
npm run build     # Build produit
npm run lint      # ESLint + TypeScript
npm run typecheck # Vérifier types sans build
```

## Variantes de modèles Ollama

```bash
ollama pull llama3            # Par défaut (13B)
ollama pull llama3:8b         # Variant plus petit
ollama pull mistral           # Mistral 7B
ollama pull qwen2.5:14b       # Qwen 14B
```

Ajuster `OLLAMA_MODEL` dans `.env.local` en conséquence.

## À retenir

1. **Auth est sérieuse** — RLS partout, validation côté serveur obligatoire
2. **Sessions = JSONB, pas de table messages** — design simple et performant
3. **Vouvoiement dans le code commenté et la doc** — convention de ce projet
4. **Ollama local = pas de cloud** — tout reste sur votre machine
5. **Parser IA robuste** — format texte + fallback, jamais du JSON strict
