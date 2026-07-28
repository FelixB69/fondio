# Tableau de bord par projet — spécification technique

Date : 2026-07-28
Statut : à implémenter
Complète : [2026-07-28-dashboard-projet.md](2026-07-28-dashboard-projet.md) (le *pourquoi* — inchangé)

Ce document décrit le *comment*. Là où il contredit la spec fonctionnelle, c'est lui
qui fait foi ; les écarts sont listés en §0.

---

## 0. Corrections à la spec fonctionnelle

Sept points de la spec fonctionnelle sont invalidés par le code réel.

| # | La spec dit | Ce que dit le code | Décision |
|---|---|---|---|
| 1 | §6.3 : réutiliser `buildSystemPrompt("pm", …)` | `AGENTS.pm.systemPrompt` est produit par `buildPrompt()` ([lib/data.ts:315-330](../../lib/data.ts#L315-L330)) qui embarque déjà `FORMAT_INSTRUCTIONS` (LIVRABLES/CHALLENGES) **et** `PEDAGOGY_INSTRUCTIONS` (qui impose `LEXIQUE:`) ; `buildSystemPrompt` y ajoute `TASKS_INSTRUCTIONS` pour `pm` ([lib/data.ts:544](../../lib/data.ts#L544)). Les trois sections interdites par §6.2 sont donc inévitables. | Prompt dédié dans `lib/project-summary.ts`. Seul `buildProjectStateInstruction()` est réutilisé. |
| 2 | Critère n°7 : « modifier une tâche fait apparaître le badge obsolète » | `tasks` n'a pas de colonne `updated_at` ([lib/data.ts:132-147](../../lib/data.ts#L132-L147)). Renommer, changer une date, passer `todo→doing` ou supprimer ne laisse aucune trace. | Migration `tasks.updated_at` + trigger `BEFORE UPDATE` (lot 2). Le critère devient vrai. |
| 3 | §5.4 : « la `TaskDetailModal` existante » | L'écran projet ne l'a jamais utilisée ; seul [AgendaScreen.tsx:264](../../components/AgendaScreen.tsx#L264) le fait. Le board édite en ligne. | Câblage neuf, possédé par `ProjectOverviewTab`. |
| 4 | §5.5 : `formatRelative()` de `lib/format.ts` | Une copie locale divergente vit en [ProjectDetailScreen.tsx:1033](../../components/ProjectDetailScreen.tsx#L1033) : `12/07/2026` au-delà de 7 jours, là où `lib/format.ts` rend `Il y a 3 sem.` | La copie locale est supprimée au lot 2, au profit de `formatRelative(iso, { absoluteAfterWeek: true })` (comportement actuel préservé). |
| 5 | §6.3 : 429 après 60 s | Aucune infrastructure de rate-limit dans le repo. Une `Map` en mémoire ne survit ni à un redéploiement ni à plusieurs instances. | Déduit de `summary.generated_at` en base. Zéro infrastructure. |
| 6 | §4.2 : trois onglets | Le bloc sessions fait ~90 lignes pour 2-3 lignes de contenu, et doublonne « Activité récente ». | **Deux onglets**. Les sessions deviennent un bloc de la vue d'ensemble. |
| 7 | (non mentionné) | `useIsMobile` renvoie `false` au premier rendu ([lib/use-responsive.ts:5](../../lib/use-responsive.ts#L5)), donc `useState(isMobile ? "list" : "kanban")` ([ProjectDetailScreen.tsx:54](../../components/ProjectDetailScreen.tsx#L54)) initialise **toujours** en Kanban. Le défaut « Liste sur mobile » n'a jamais fonctionné. | Corrigé au lot 1 par un effet. |

**§11 tranché** : deux onglets · seuil d'inactivité à **21 jours** · synthèse rédigée par **Clara**.

**Critères d'acceptation réécrits** (les autres sont inchangés) :

- **n°3** — Cliquer « En retard » navigue vers `?tab=taches&filter=overdue` ; l'URL est
  partageable et le retour arrière ramène à la vue d'ensemble.
- **n°6** — `Faire le point` produit un texte en prose, sans section `LIVRABLES:` /
  `TÂCHES:` / `LEXIQUE:`, sans terme technique absent du glossaire, et la carte affiche
  le `providerLabel` réellement retourné par `callChatModel`.
- **n°7** — Modifier une tâche (intitulé, statut, priorité, date) fait apparaître
  « Peut être obsolète ». Supprimer une tâche ne le fait pas — c'est admis.

---

## 1. Découpage en trois lots

Chaque lot passe `npm run typecheck && npm test`, est utilisable seul, et se relit
indépendamment.

| Lot | Contenu | Migration | Réseau |
|---|---|---|---|
| **1** | Extraction en deux onglets. Aucune fonctionnalité nouvelle. | — | — |
| **2** | `buildDashboard()` + vue d'ensemble complète, sans IA. | `tasks.updated_at` | — |
| **3** | Synthèse IA : route, carte, persistance. | `projects.summary` | 1 appel LLM sur clic |

**Règle sur les migrations** : les fichiers `.sql` sont écrits dans
`supabase/migrations/`, **jamais exécutés par Claude**. Chaque lot commence par une
étape bloquante « appliquer la migration », à faire avant de déployer le code du lot.
Les deux migrations sont additives et instantanées ; les appliquer en avance ne casse
rien pour le code déjà en place. **L'ordre inverse casse l'écran projet** (§5.1).

Jamais de `drop table`, jamais de `create table`, un `ALTER` isolé par fichier.

---

## 2. Décisions transversales

### 2.1 L'URL est la source de vérité de la navigation

```
/projects/:id                              → vue d'ensemble
/projects/:id?tab=taches                   → board, filtre « Toutes »
/projects/:id?tab=taches&filter=overdue    → board, filtre « En retard »
```

- `?tab=` absent ou inconnu → vue d'ensemble. `?filter=` absent ou inconnu → `"all"`.
- Changement d'onglet → `router.push` (le retour arrière ramène à la vue d'ensemble).
- Changement de filtre → `router.replace` (n'empile pas d'entrée d'historique).
- Vue d'ensemble et filtre `all` → paramètre **retiré** de l'URL (forme canonique).
- Le `useState<TaskFilter>` de [ProjectDetailScreen.tsx:55](../../components/ProjectDetailScreen.tsx#L55) disparaît.

`useSearchParams` est lu **uniquement** par `ProjectDetailScreen` ; les onglets
reçoivent `filter` / `onFilterChange` en props et restent ignorants du routeur. La page
enveloppe l'écran dans un `<Suspense>`, comme le fait déjà
[agents/page.tsx:37](<../../app/(authenticated)/agents/page.tsx#L37>).

### 2.2 Données

- **Tâches** : `useTasks({ projectId })`, appelé par le parent (compteurs du header et
  badge d'onglet) **et** par chaque onglet. Clé SWR `"tasks"` unique → un seul fetch
  réseau, trois abonnements au même cache. Changer d'onglet ne déclenche aucune requête
  (critère n°9).
- **Projet + sessions** : `useState` + `load()` conservés dans `ProjectDetailScreen`.
  Personne d'autre ne consomme ces données, et les écritures optimistes (`setProject`)
  sont déjà en place pour l'étape ; la synthèse suivra le même chemin.
- La requête `glossary` défensive et séquentielle
  ([ProjectDetailScreen.tsx:92](../../components/ProjectDetailScreen.tsx#L92)) est
  repliée dans le select principal : **3 allers-retours → 2 en parallèle**. Cette
  prudence était périmée — [/api/chat](../../app/api/chat/route.ts#L87) sélectionne
  `glossary` sans filet, donc la colonne existe en production.

### 2.3 Développement piloté par les tests

Rouge-vert strict sur les trois lots, y compris l'extraction : le test du composant
cible est écrit **avant** que le fichier existe (rouge : module introuvable), le
composant est créé en déplaçant le code (vert), puis le parent est vidé (reste vert).

**Ce qu'on teste** : quel handler est appelé avec quels arguments, ce qui est rendu ou
non, les états vides, le câblage des filtres, les codes HTTP.
**Ce qu'on ne teste jamais** : couleurs, tailles, bordures, marges. C'est le rôle de la
check-list manuelle (§7).

**Mocks** : `@/lib/use-tasks` (helper `makeUseTasks`) et `next/navigation`. Pas de SWR,
pas de Supabase, pas d'`await waitFor` sur des composants — tests synchrones et
déterministes.

**Horloge** : aucune injection. On suit la convention de
[lib/tasks.test.ts](../../lib/tasks.test.ts) — dates relatives construites avec
`todayStr()` / `inDaysStr()` / `addDaysYmd()` pour les `date`, et
`new Date(Date.now() - n * 86400000).toISOString()` pour les `timestamptz`.

Le harnais est déjà complet ([vitest.config.ts](../../vitest.config.ts),
[test/setup.ts](../../test/setup.ts)) : jsdom déclaré par fichier via
`// @vitest-environment jsdom`, `@testing-library/react` + `user-event`, matchers
jest-dom, stub `matchMedia`. Rien à installer.

---

## 3. Lot 1 — extraction en deux onglets

Déplacement de code. Un seul comportement change : le défaut mobile (correction n°7).

### 3.1 Fichiers

**Nouveaux**

| Fichier | Rôle |
|---|---|
| `components/ProjectTasksTab.tsx` | Quick-add, `ViewToggle`, `FilterChips`, Kanban/Liste, `TaskCard`, `TaskRow` |
| `components/ProjectTasksTab.test.tsx` | Rouge-vert de l'extraction |
| `components/ProjectOverviewTab.tsx` | Lot 1 : sessions + glossaire. Lot 2 : le cockpit |
| `components/ProjectOverviewTab.test.tsx` | Rouge-vert de l'extraction |
| `test/helpers/use-tasks.ts` | `makeUseTasks(tasks)` → `UseTasksResult` aux mutations `vi.fn()` |

**Modifiés**

- `components/ProjectDetailScreen.tsx` — header + barre d'onglets + lecture de l'URL.
  ~1043 → ~280 lignes.
- `app/(authenticated)/projects/[id]/page.tsx` — enveloppe `<Suspense>`.
- `lib/projects.ts` — accueille le type `ProjectSessionRow` (forme de données, pas de JSX).

### 3.2 Contrats

```ts
// lib/projects.ts — déplacé depuis ProjectDetailScreen, partagé parent ⇄ onglet
export interface ProjectSessionRow {
  id: string;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  updated_at: string;
  panel_agent_ids?: string[] | null;
}
```

```ts
// components/ProjectTasksTab.tsx
interface ProjectTasksTabProps {
  projectId: string;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  onOpenSession: (sessionId: string) => void;
}
```

L'onglet appelle `useTasks({ projectId })` et déstructure les dix mutations exactement
comme le fait l'écran aujourd'hui ([ProjectDetailScreen.tsx:59-70](../../components/ProjectDetailScreen.tsx#L59-L70)).
`view`, `newTaskText` et les compteurs de chips (`filterCounts`) sont internes.

```ts
// components/ProjectOverviewTab.tsx — lot 1
interface ProjectOverviewTabProps {
  project: Project;
  sessions: ProjectSessionRow[];
  onOpenSession: (sessionId: string) => void;
}
```

Le lot 2 étend cette interface ; le lot 1 ne déclare que ce qu'il utilise.

### 3.3 Header et barre d'onglets

Le header reste dans `ProjectDetailScreen`, au-dessus des onglets : retour, icône +
nom, genre IT, compteur `X / Y tâches · Z %`, stepper des 6 étapes, barre de
progression, bouton `+ Session`.

**Descendent dans l'onglet Tâches** : le champ « Nouvelle tâche pour ce projet… », le
sélecteur Liste/Kanban et les chips de filtre.

Barre d'onglets, sous la barre de progression :

| Onglet | Paramètre | Badge |
|---|---|---|
| Vue d'ensemble (défaut) | *(absent)* | — |
| Tâches | `?tab=taches` | `tasks.filter(t => t.status !== "done").length` |

Sur mobile, deux onglets tiennent sur une ligne sans défilement.

### 3.4 Chargement fusionné

```ts
const [projRes, sessRes] = await Promise.all([
  supabase.from("projects")
    .select("id, name, icon, color, project_type, stage, glossary, created_at, updated_at")
    .eq("id", projectId).single(),
  supabase.from("sessions")
    .select("id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
    .eq("project_id", projectId).is("archived_at", null)
    .order("updated_at", { ascending: false }),
]);
```

La seconde requête `projects.select("glossary")` disparaît. Le lot 3 ajoutera `summary`
à cette même liste de colonnes.

### 3.5 Correction du défaut mobile

```ts
const [view, setView] = useState<ViewMode>("kanban");
useEffect(() => { setView(isMobile ? "list" : "kanban"); }, [isMobile]);
```

Compromis assumé : franchir le point de rupture en redimensionnant réécrase un choix
manuel. Le cas est marginal ; l'alternative (mémoriser que l'utilisateur a touché au
sélecteur) ne vaut pas sa complexité.

### 3.6 Séquence rouge-vert

1. `ProjectTasksTab.test.tsx` → **rouge** (`Cannot find module "./ProjectTasksTab"`).
2. `ProjectTasksTab.tsx` créé en déplaçant le JSX, `TaskCard` et `TaskRow` → **vert**.
3. `ProjectOverviewTab.test.tsx` → **rouge**. `ProjectOverviewTab.tsx` créé en déplaçant
   les blocs glossaire et sessions → **vert**.
4. `ProjectDetailScreen` vidé de ce qui a bougé, barre d'onglets et lecture d'URL
   ajoutées → reste **vert**.
5. Check-list manuelle §7.

---

## 4. Lot 2 — le cockpit

### 4.1 Migration (à appliquer avant le code)

```sql
-- supabase/migrations/2026-07-28-tasks-updated-at.sql
alter table public.tasks
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tasks_touch_updated on public.tasks;
create trigger tasks_touch_updated
  before update on public.tasks
  for each row execute function public.touch_updated_at();
```

Horodatage **côté serveur** : aucune des huit mutations de `use-tasks.ts` n'a à écrire
`updated_at`, et aucun oubli futur n'est possible.

Répercussions dans le code :

- `lib/data.ts` — `Task` gagne `updated_at: string`.
- `lib/use-tasks.ts` — `TASK_COLS` gagne `updated_at`.
- Les fabriques `makeTask()` des tests existants
  ([lib/tasks.test.ts](../../lib/tasks.test.ts),
  [components/TaskBits.test.tsx](../../components/TaskBits.test.tsx)) reçoivent le champ.

`updated_at` ne sert **que** à l'obsolescence de la synthèse et à la règle
d'inactivité. Il n'alimente pas le flux d'activité : « Tâche modifiée » serait du bruit.

### 4.2 `lib/projects.ts`

`Stage` gagne une phrase d'explication en langage simple (§5.2 de la spec
fonctionnelle) :

```ts
export interface Stage {
  id: StageId;
  name: string;
  icon: string;
  color: string;
  description: string;
}
```

| Étape | `description` |
|---|---|
| Cadrage | « On décide quoi construire, pour qui, et jusqu'où. À cette étape, mieux vaut écrire ce que le projet ne fera **pas** que d'ouvrir un chantier trop large. » |
| Conception | « On dessine avant de construire : les écrans, les parcours, les briques techniques. Corriger un dessin coûte quelques minutes, corriger du code coûte des jours. » |
| Développement | « On construit. L'essentiel est de découper le travail en petits morceaux livrables et de vérifier chaque morceau au fur et à mesure. » |
| Recette | « On vérifie que ça marche vraiment, en se mettant à la place de l'utilisateur. Faites tester par quelqu'un qui n'a pas participé : il trouvera ce que vous ne voyez plus. » |
| Mise en ligne | « On ouvre au public. Prévoyez comment revenir en arrière si quelque chose se passe mal — c'est ce qui rend la mise en ligne sereine. » |
| Maintenance | « Le projet vit. On corrige, on améliore, on surveille. C'est une étape longue, pas une fin. » |

### 4.3 `lib/project-dashboard.ts`

Une entrée, une sortie, aucun JSX. Un seul `useMemo` côté composant, un seul point
d'entrée de test.

```ts
export type DashboardAction =
  | { kind: "tasks"; filter: TaskFilter }
  | { kind: "agenda" }
  | { kind: "newSession"; agentId: AgentId }
  | { kind: "nextStage"; stage: StageId };

export type AlertId = "overdue" | "nodates" | "noplan" | "idle" | "allDone" | "stalled";

export interface DashboardAlert {
  id: AlertId;
  level: "warn" | "info";
  message: string;
  actionLabel: string;
  action: DashboardAction;
}

export interface ActivityItem {
  id: string;
  kind: "session" | "taskDone" | "taskCreated";
  label: string;            // « Échange avec Clara », « Tâche terminée »
  detail: string;           // titre de session ou intitulé de tâche
  ts: string;               // ISO
  sessionId?: string;       // présent ⇒ ligne cliquable
}

export interface DashboardKpis {
  progress: number | null;  // null si aucune tâche → l'UI affiche « — », pas « 0 % »
  done: number;
  total: number;
  overdue: number;
  week: number;
  deliverables: number;
}

export interface Dashboard {
  kpis: DashboardKpis;
  alerts: DashboardAlert[];   // 0 à 3, par priorité décroissante
  upcoming: Task[];           // 5 max
  activity: ActivityItem[];   // 6 max
  isBlank: boolean;
  summaryStale: boolean;      // lot 3 ; false tant que projects.summary est null
}

export function buildDashboard(input: {
  project: Project;
  tasks: Task[];
  sessions: ProjectSessionRow[];
}): Dashboard;
```

Constantes exportées (testées, et réutilisées par le lot 3) :

```ts
export const IDLE_DAYS = 21;
export const MAX_ALERTS = 3;
export const MAX_UPCOMING = 5;
export const MAX_ACTIVITY = 6;
export const STALLED_MIN_TASKS = 5;
```

**KPI** — `overdue` et `week` passent par `filterCounts(tasks)` : garantit par
construction que les tuiles et les chips de l'onglet Tâches affichent les mêmes nombres
(critère n°2). `deliverables` vient de `computeStats(sessions, done).deliverablesCount`.
`progress` vaut `null` si `total === 0`, sinon `Math.round(done / total * 100)`.

**Règles de vigilance**, évaluées dans cet ordre, trois premières satisfaites retenues :

| # | `id` | Condition | Niveau | Message | Action |
|---|---|---|---|---|---|
| 1 | `overdue` | `kpis.overdue > 0` | warn | « **N tâches** ont dépassé leur date. » | `{ kind: "tasks", filter: "overdue" }` — « Voir les retards » |
| 2 | `nodates` | `tasks.length > 0` et aucune `due_date` | info | « Aucune de vos tâches n'a de date. Difficile de savoir ce qui vient ensuite. » | `{ kind: "agenda" }` — « Planifier » |
| 3 | `noplan` | `tasks.length === 0` | info | « Ce projet n'a pas encore de plan d'action. » | `{ kind: "newSession", agentId: "pm" }` — « Demander un plan à Clara » |
| 4 | `idle` | `lastActivityAt` > 21 jours | warn | « Ce projet est en pause depuis N jours. » | `{ kind: "newSession", agentId: "pm" }` — « Reprendre une session » |
| 5 | `allDone` | `progress === 100` et `stage !== "maintenance"` | info | « Toutes vos tâches sont faites. Prêt à passer à l'étape suivante ? » | `{ kind: "nextStage", stage }` — « Passer à *étape* » |
| 6 | `stalled` | `stageIndex >= 2` et `progress === 0` et `total >= 5` | warn | « Vous êtes en *Développement* mais aucune tâche n'est terminée. » | `{ kind: "tasks", filter: "all" }` — « Voir les tâches » |

Deux niveaux visuels : **warn** ambre `#D97706`, **info** bleu `C.navy`. Pas de rouge —
il est réservé au compteur de retards, pour ne pas banaliser l'alarme. Aucune règle
satisfaite → le bloc disparaît (pas de « tout va bien », c'est du bruit).

`lastActivityAt(tasks, sessions)` = maximum de `task.updated_at`, `task.created_at` et
`session.updated_at`. Renvoie `null` si tout est vide (la règle 4 ne se déclenche alors
pas).

**Prochaines échéances** — tâches `status !== "done"` avec une `due_date`, triées par
`compareTasks()` (retards en tête), cinq premières.

**Activité** — fusion de trois sources triées par `ts` décroissant, six premières :

| Source | `ts` | `label` | `detail` |
|---|---|---|---|
| session | `updated_at` | « Échange avec *prénom* », ou « Panel · N agents » si `panel_agent_ids.length > 1` | `title ?? "Nouvelle session"` |
| tâche avec `completed_at` | `completed_at` | « Tâche terminée » | `content` |
| tâche | `created_at` | « Tâche ajoutée » | `content` |

**`isBlank`** — `tasks.length === 0 && sessions.length === 0`.

### 4.4 `components/ProjectOverviewTab.tsx`

```ts
interface ProjectOverviewTabProps {
  project: Project;
  sessions: ProjectSessionRow[];
  onOpenSession: (sessionId: string) => void;
  onAction: (action: DashboardAction) => void;   // traduit l'intention en navigation
  onStageChange: (stage: StageId) => void;
}
```

`onAction` est implémenté dans `ProjectDetailScreen` :

| `kind` | Effet |
|---|---|
| `tasks` | `push(?tab=taches&filter=…)` |
| `agenda` | `push("/agenda")` |
| `newSession` | `push("/agents?type=…&project=…")` — même chemin que le bouton `+ Session` |
| `nextStage` | `onStageChange(stage)` |

Ordre de lecture des blocs :

1. Rangée de 4 tuiles KPI (grille 2 × 2 sur mobile). « En retard » passe en `#DC2626`
   si `> 0`, sinon gris neutre — aucune autre tuile ne change de couleur. « Livrables »
   fait défiler vers le bloc Sessions (il n'y a plus d'onglet Sessions).
2. Carte « Étape en cours » : nom, position `3 / 6`, couleur de `STAGES`, la
   `description`, et le bouton `Passer à : Recette` issu de `nextStage()` — masqué en
   `maintenance`. Seul endroit du dashboard qui enseigne plutôt qu'il ne mesure.
3. Points de vigilance (0 à 3).
4. Prochaines échéances — clic ouvre `TaskDetailModal`.
5. Activité récente — seules les lignes portant un `sessionId` sont cliquables.
6. Sessions du projet *(déplacé ici au lot 1)*.
7. Glossaire *(déplacé ici au lot 1)* : 6 termes les plus récents, bouton
   `Afficher les N termes`, masqué si vide.
8. Carte de synthèse *(lot 3)*.

**État « projet vierge »** (`isBlank`) : les blocs 1, 3, 4, 5 sont remplacés par une
carte d'amorçage unique — « Votre projet est créé. Et maintenant ? » + bouton
`Démarrer avec Clara` (`{ kind: "newSession", agentId: "pm" }`). Les cartes « Étape en
cours » et « Synthèse » restent affichées.

**`TaskDetailModal`** : l'onglet garde un `selectedTask` et branche les treize handlers
sur son propre `useTasks`. On passe `project` à `undefined` — la puce projet serait
redondante ici. Le board n'est pas touché : on reste sur le cockpit après fermeture,
c'est tout l'intérêt.

`formatRelative` est importé de [lib/format.ts](../../lib/format.ts) avec
`{ absoluteAfterWeek: true }` ; la copie locale de `ProjectDetailScreen` est supprimée.

---

## 5. Lot 3 — synthèse IA

### 5.1 Migration (à appliquer avant le code)

```sql
-- supabase/migrations/2026-07-28-project-summary.sql
alter table public.projects
  add column if not exists summary jsonb;
```

**L'ordre est bloquant** : `summary` est ajouté au select principal de `load()`. Si le
code part avant la migration, l'écran projet entier tombe — pas seulement la carte.

Forme stockée (une seule synthèse par projet, la dernière écrase la précédente) :

```jsonc
{
  "text": "Votre projet avance bien…",
  "provider": "local",
  "providerLabel": "Mistral (local)",
  "generated_at": "2026-07-28T10:12:00.000Z"
}
```

### 5.2 `lib/projects.ts`

```ts
import type { LLMProvider } from "./llm";   // import de TYPE : effacé à la compilation

export interface ProjectSummary {
  text: string;
  provider: LLMProvider;
  providerLabel: string;
  generated_at: string;
}

// Garde de lecture : le JSONB arrive en `unknown`. Renvoie null sur toute forme
// inattendue plutôt que de laisser une valeur douteuse traverser l'UI.
export function parseProjectSummary(raw: unknown): ProjectSummary | null;
```

`Project` gagne `summary?: ProjectSummary | null`.

### 5.3 `lib/project-summary.ts`

Module pur et testable. Aucun emprunt aux couches de format de `lib/data.ts`.

```ts
export const SUMMARY_MIN_INTERVAL_MS = 60_000;
export const SUMMARY_MAX_LENGTH = 4_000;

export function buildProjectSummaryPrompt(input: {
  project: Pick<Project, "name" | "stage" | "glossary">;
  tasks: Task[];
  sessions: ProjectSessionRow[];
}): LLMMessage[];
```

Renvoie deux messages — un `system` et un `user` (« Faites le point sur ce projet. ») :
Ollama attend un tour utilisateur.

Le bloc `system` est composé de, dans l'ordre :

1. **Persona Clara condensée** — trois lignes, réécrites pour l'usage. Pas d'import
   depuis `AGENTS` : sa `systemPrompt` traîne les sections interdites (§0.1).
2. **Vouvoiement systématique** et **interdiction d'inventer** : la synthèse ne parle
   que de ce qui figure dans les données fournies.
3. `buildProjectStateInstruction({ name, stage, tasks })` — existant et testé
   ([lib/projects.ts:122](../../lib/projects.ts#L122)).
4. **Ce que voit l'utilisateur** : `buildDashboard()` est appelé en interne et ses
   `kpis`, `alerts` et `activity` sont sérialisés dans le prompt. Une seule source de
   vérité : Clara commente exactement le cockpit affiché à l'écran.
5. **Termes autorisés** — `buildAllowedTermsInstruction(glossary)`, local à ce module :
   les termes du glossaire sont réutilisables tels quels, **tout autre jargon technique
   est interdit**. `lib/glossary.ts` n'est pas modifié (sa consigne mentionne la section
   `LEXIQUE`, hors sujet ici).
6. **Format** — 4 à 6 phrases, prose continue, en couvrant dans l'ordre : où en est le
   projet, ce qui a avancé, ce qui bloque, deux ou trois prochaines actions. Aucun
   titre, aucune puce, aucune section en majuscules.

### 5.4 `app/api/project-summary/route.ts`

`POST /api/project-summary` — corps `{ projectId: string }`, réponse **non streamée**
(le texte est court, le streaming n'apporterait qu'une complexité d'UI).

| Cas | Code | Réponse |
|---|---|---|
| OK | 200 | `{ text, provider, providerLabel, generated_at }` |
| JSON invalide ou `projectId` manquant | 400 | `{ error }` |
| Non authentifié | 401 | `{ error }` |
| Projet inexistant ou d'un autre utilisateur | 404 | `{ error }` |
| Moins de 60 s depuis la dernière génération de ce projet | 429 | `{ error }` |
| LLM injoignable | 503 | `{ error: describeLLMError(e) }` |

Séquence :

```ts
export const runtime = "nodejs";

// 1. corps → 400
// 2. supabase.auth.getUser() → 401
// 3. projects.select("name, stage, glossary, summary")
//      .eq("id", projectId).eq("user_id", user.id).single()   → 404
// 4. parseProjectSummary(project.summary)
//      generated_at < 60 s ?  → 429, AVANT tout appel au modèle
// 5. Promise.all([ tasks du projet, sessions du projet ])
// 6. buildProjectSummaryPrompt({ project, tasks, sessions })
// 7. loadUserByokConfig(supabase, user.id)
//    callChatModel(messages, { byok })      → catch : 503 describeLLMError(e)
// 8. parseAgentReply(raw).content           ← filet : un modèle local peut produire
//    vide ? → 503                              des sections malgré la consigne
// 9. projects.update({ summary }).eq("id", projectId)
// 10. 200
```

Points fermes :

- **Le serveur recharge tout lui-même.** Aucune donnée d'état n'est acceptée du client,
  qui pourrait mentir.
- **Le rate-limit ne coûte rien** : `generated_at` est déjà chargé pour le prompt. Un
  503 n'écrit pas `summary`, donc une re-tentative après échec est immédiatement
  possible — c'est le comportement voulu.
- **Aucune préférence local/cloud à honorer** : `ChatSession` et `MultiAgentSession`
  initialisent chacun un `useState("cloud")` purement local, rien n'est persisté. Seul
  BYOK est chargé, comme dans `/api/chat`.
- `text` est tronqué à `SUMMARY_MAX_LENGTH` avant écriture (même logique que la borne
  anti-DoS sur les messages de chat).

### 5.5 Carte « Où en est mon projet ? »

Quatre états :

| État | Rendu |
|---|---|
| Initial | Titre, « Clara relit vos tâches, vos échanges et votre étape, et vous fait un point en clair. », bouton `Faire le point` |
| En cours | Bouton désactivé + indicateur |
| Résultat | Le texte, puis en pied `Établi il y a 2 jours · Mistral (local)` et `Refaire le point` |
| Erreur | Le message de la route ; le reste du dashboard reste fonctionnel |

- **Jamais de génération automatique** au chargement.
- Bouton désactivé, avec explication, si `isBlank` : il n'y a rien à synthétiser.
- `summaryStale` → badge discret `Peut être obsolète` à côté de la date. Calculé par
  `buildDashboard` : `summary != null && lastActivityAt > summary.generated_at`.
- Après un 200, `setProject(p => ({ ...p, summary }))` — pas de rechargement.
- Le `providerLabel` affiché est celui **retourné par la route**, jamais une constante
  côté client (règle produit : l'UI nomme le provider réel).

---

## 6. Plan de test

### Lot 1 — `components/ProjectTasksTab.test.tsx`

```
□ rend les trois colonnes Kanban avec les bons compteurs
□ colonne vide → « Vide. »
□ filter="overdue" → seules les tâches en retard sont rendues
□ le clic sur une chip appelle onFilterChange avec le bon filtre
□ les compteurs de chips sont calculés sur l'ensemble, pas sur le sous-ensemble filtré
□ quick-add : appelle addTask({ content }) puis vide le champ
□ quick-add : bouton désactivé si le champ est vide
□ pastille de statut → cycleStatus(task)
□ select de statut → setStatus(task, "done")
□ bouton supprimer → removeTask(task)
□ édition inline du titre → setContent(task, texte)
□ tâche avec source_agent_id + session_id → bouton d'ouverture de session
□ aucune tâche → message d'invitation
```

`components/ProjectOverviewTab.test.tsx` : rend les sessions (titre, agent, panel),
rend le glossaire, masque chaque bloc quand il est vide, clic sur une session →
`onOpenSession(id)`.

### Lot 2 — `lib/project-dashboard.test.ts`

```
□ KPI : progress null si aucune tâche, arrondi correct sinon
□ KPI : overdue/week identiques à filterCounts (même jeu de tâches)
□ KPI : deliverables agrégés depuis les messages assistant des sessions
□ chaque règle 1→6 se déclenche sur son cas nominal
□ chaque règle 1→6 NE se déclenche PAS sur son cas limite voisin
□ au plus 3 alertes, dans l'ordre de priorité
□ projet sain → alerts vide
□ règle 4 : 20 jours ne déclenche pas, 22 jours déclenche
□ upcoming : exclut les done et les sans-date, retards en tête, 5 max
□ activity : trois sources fusionnées, tri décroissant, 6 max
□ activity : session panel → label « Panel · N agents »
□ isBlank : vrai seulement si zéro tâche ET zéro session
□ summaryStale : faux si summary null ; vrai si une tâche a bougé après generated_at
```

`components/ProjectOverviewTab.test.tsx` étendu : rendu des tuiles, `—` quand
`progress` est null, `onAction` appelé avec la bonne intention pour chaque tuile et
chaque alerte, carte d'amorçage quand `isBlank`, ouverture de `TaskDetailModal` au clic
sur une échéance.

### Lot 3

`lib/project-summary.test.ts`

```
□ le prompt ne contient ni « LIVRABLES: » ni « TÂCHES: » ni « LEXIQUE: »
□ le prompt contient le bloc buildProjectStateInstruction
□ les termes du glossaire apparaissent comme autorisés
□ glossaire vide → aucune consigne de termes autorisés
□ renvoie exactement deux messages, system puis user
```

`app/api/project-summary/route.test.ts`, sur le modèle de
[artifacts/download](../../app/api/artifacts/download/route.test.ts) :

```
□ 400 sur JSON invalide, 400 sans projectId
□ 401 sans utilisateur
□ 404 sur projet inexistant
□ 404 sur projet appartenant à un autre utilisateur
□ 429 si generated_at date de moins de 60 s — et le modèle N'EST PAS appelé
□ 200 si generated_at date de plus de 60 s
□ 503 quand callChatModel lève, avec le message de describeLLMError
□ le texte stocké est débarrassé d'une section LIVRABLES émise malgré la consigne
□ 200 : projects.update est appelé avec un summary bien formé
```

`lib/projects.test.ts` étendu : `parseProjectSummary` renvoie `null` sur `null`, sur une
chaîne, sur un objet incomplet, et l'objet typé sur une forme valide.

---

## 7. Check-list de non-régression manuelle

Dans l'application lancée, sur un projet réel comportant des tâches datées, une tâche
issue d'un agent et au moins une session. Ce que jsdom ne voit pas.

**Après le lot 1**

```
□ quick-add crée bien la tâche dans le projet courant
□ bascule Liste ⇄ Kanban
□ défaut = Liste sous 768 px (le correctif n°7)
□ les 4 chips affichent les mêmes compteurs qu'avant
□ cycle de statut, select de statut, suppression
□ édition inline du titre (blur et Entrée)
□ priorité, date de début, échéance
□ lien « session source » sur une tâche issue d'un agent
□ stepper d'étape → persiste après F5
□ blocs glossaire et sessions rendus dans la vue d'ensemble
□ ?tab=taches&filter=overdue est partageable et se recharge correctement
□ retour arrière : Tâches → Vue d'ensemble → sortie du projet
□ changer d'onglet ne déclenche aucune requête (onglet Réseau)
□ npm run typecheck && npm test
```

**Après le lot 2**

```
□ les 4 tuiles concordent avec les chips de l'onglet Tâches
□ clic « En retard » → onglet Tâches, filtre déjà appliqué
□ projet à 3 tâches en retard → l'alerte correspondante s'affiche
□ projet sain → aucun bloc de vigilance
□ projet vierge → carte d'amorçage, pas des tuiles à zéro
□ clic sur une échéance → TaskDetailModal, et on reste sur le cockpit
□ grille 2 × 2 des KPI sous 768 px
```

**Après le lot 3**

```
□ Faire le point → texte français en prose, sans section ni jargon non expliqué
□ le provider affiché correspond au modèle réellement utilisé
□ la synthèse survit à F5
□ terminer une tâche → badge « Peut être obsolète »
□ renommer une tâche → badge « Peut être obsolète » (vérifie le trigger)
□ deux clics rapprochés → message de limitation, pas de double appel
□ Ollama arrêté et sans clé cloud → erreur explicite, le reste du dashboard fonctionne
```

---

## 8. Hors périmètre

Inchangé par rapport à §9 de la spec fonctionnelle : pas de graphes, pas d'historique
des changements d'étape, pas de dashboard multi-projets sur `/home`, pas d'export PDF,
pas de vélocité ni d'estimation de date de fin.

S'y ajoute : le flux d'activité n'affiche pas les modifications de tâches (`updated_at`
sert uniquement à l'obsolescence et à l'inactivité), et la suppression d'une tâche ne
rend pas la synthèse obsolète.
