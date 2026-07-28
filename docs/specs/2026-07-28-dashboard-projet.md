# Tableau de bord par projet

Date : 2026-07-28
Statut : spécification fonctionnelle — à valider avant implémentation

## 1. Objectif

Donner au porteur de projet une **réponse immédiate à la question « où j'en suis ? »**
quand il ouvre un projet, sans avoir à lire un board de tâches ni rouvrir ses sessions.

Aujourd'hui, ouvrir un projet affiche directement un Kanban de tâches. C'est un écran
d'**exécution** : il répond à « qu'est-ce que je fais maintenant ? », pas à « est-ce que
ça avance, et qu'est-ce qui coince ? ». Pour une cible non-technique qui pilote seule un
projet IT, la deuxième question est la plus anxiogène — et c'est justement celle à
laquelle Fondio doit répondre.

Le dashboard est donc un **cockpit de pilotage** : des indicateurs lisibles, des points
de vigilance formulés en langage clair, et une synthèse rédigée par un agent.

## 2. Contexte existant

Ce qui est déjà en place et sur quoi le dashboard s'appuie :

| Brique | Où | Ce qu'elle apporte |
|---|---|---|
| Écran projet | [components/ProjectDetailScreen.tsx](../../components/ProjectDetailScreen.tsx) (1043 l.) | Header + stepper d'étape + board de tâches + glossaire + liste des sessions |
| Étapes de livraison | [lib/projects.ts:30-52](../../lib/projects.ts#L30-L52) | `STAGES` (6 étapes), `stageMeta`, `stageIndex`, `nextStage` |
| Statistiques | [lib/projects.ts:75-104](../../lib/projects.ts#L75-L104) | `computeStats()` → sessions, livrables, tâches faites, XP |
| Logique tâches | [lib/tasks.ts](../../lib/tasks.ts) | `matchesFilter`, `filterCounts`, `compareTasks`, `dueDateMeta`, `agendaBucket` |
| Cache tâches | [lib/use-tasks.ts](../../lib/use-tasks.ts) | `useTasks({ projectId })` — cache SWR **partagé**, un seul fetch pour toute l'app |
| Glossaire projet | `projects.glossary` (jsonb) | Termes techniques déjà expliqués, affichés en bas de l'écran projet |
| Appel LLM | [lib/llm.ts:87](../../lib/llm.ts#L87) | `callChatModel()` — local d'abord, cloud en secours, BYOK |
| État projet → prompt | [lib/projects.ts:122-161](../../lib/projects.ts#L122-L161) | `buildProjectStateInstruction()` — décrit déjà l'étape, l'avancement et les tâches ouvertes à un LLM |

**Point clé** : presque toutes les données nécessaires sont déjà chargées par l'écran
projet. Le dashboard est en grande partie une **relecture** de données existantes, pas
une nouvelle collecte.

## 3. Décisions structurantes

1. **Navigation par onglets** dans `/projects/[id]` : `Vue d'ensemble · Tâches · Sessions`.
   Le dashboard devient l'onglet par défaut ; le board actuel bascule dans `Tâches`.
   Motivation : la page est déjà très chargée, et ajouter un cockpit au-dessus du Kanban
   allongerait le scroll sans clarifier la hiérarchie.
2. **Aucun calcul serveur pour les indicateurs.** Tous les KPI, alertes et flux d'activité
   sont dérivés côté client des données déjà en cache. Aucune migration pour cette partie.
3. **La synthèse IA n'est jamais générée automatiquement.** Elle part d'un clic explicite
   (coût LLM + latence du modèle local). Elle est ensuite persistée et réaffichée.
4. **Le dashboard est en lecture, sauf trois actions** : avancer d'étape, régénérer la
   synthèse, et les raccourcis qui renvoient vers l'onglet `Tâches` pré-filtré.

## 4. Structure de l'écran

### 4.1 Header (persistant, au-dessus des onglets)

Inchangé par rapport à l'existant : retour, icône + nom du projet, genre IT, compteur
`X / Y tâches · Z %`, stepper des 6 étapes cliquable, barre de progression, bouton
`+ Session`.

**Retiré du header** : le champ « Nouvelle tâche pour ce projet… », le sélecteur
Liste/Kanban et les chips de filtre. Ils descendent dans l'onglet `Tâches` — ce sont des
outils d'exécution, ils n'ont pas leur place au-dessus d'un cockpit.

### 4.2 Barre d'onglets

| Onglet | Contenu | Badge |
|---|---|---|
| **Vue d'ensemble** (défaut) | Le dashboard décrit en §5 | — |
| **Tâches** | Le board actuel (quick-add, filtres, Liste/Kanban) | Nombre de tâches ouvertes |
| **Sessions** | La liste des sessions du projet (bloc existant) | Nombre de sessions |

- L'onglet actif est reflété dans l'URL : `?tab=taches`, `?tab=sessions` (absent = vue
  d'ensemble). Cela rend chaque onglet partageable et permet aux tuiles KPI de faire du
  deep-link.
- Sur mobile, la barre d'onglets reste sur une ligne (3 onglets courts, pas de scroll
  horizontal nécessaire).

## 5. Contenu de l'onglet « Vue d'ensemble »

Sept blocs, dans cet ordre de lecture.

### 5.1 Rangée de KPI (4 tuiles)

| Tuile | Valeur | Sous-titre | Au clic |
|---|---|---|---|
| **Avancement** | `%` de tâches faites | `12 / 30 tâches` | Onglet `Tâches` |
| **En retard** | Nb de tâches `matchesFilter(t, "overdue")` | `à traiter en priorité` | Onglet `Tâches` filtre `overdue` |
| **Cette semaine** | Nb de tâches `matchesFilter(t, "week")` | `échéances à 7 jours` | Onglet `Tâches` filtre `week` |
| **Livrables** | `stats.deliverablesCount` | `produits par vos agents` | Onglet `Sessions` |

Règles d'affichage :

- « En retard » passe en rouge (`#DC2626`) dès que la valeur est > 0, sinon gris neutre.
  Aucune autre tuile ne change de couleur — une seule alerte visuelle à la fois.
- `0 tâche` au total → « Avancement » affiche `—` et non `0 %` (0 % est décourageant et
  factuellement faux : rien n'a été planifié, ce n'est pas la même chose que rien de fait).
- Sur mobile : grille 2 × 2.

### 5.2 Carte « Étape en cours »

- Nom de l'étape courante + position (`3 / 6`), avec la couleur définie dans `STAGES`.
- **Une phrase d'explication en langage simple**, propre à l'étape. Exemple pour
  `Développement` : « On construit. À cette étape, l'essentiel est de découper le travail
  en petits morceaux livrables et de vérifier chaque morceau au fur et à mesure. »
  → nécessite d'ajouter un champ `description` à chaque entrée de `STAGES`.
- Bouton `Passer à : Recette` (libellé issu de `nextStage()`), masqué en `Maintenance`.

Cette carte est le seul endroit du dashboard où l'on **enseigne** plutôt qu'on ne mesure.
Elle est cohérente avec le positionnement produit : le porteur non-technique ne sait pas
forcément ce qu'on attend de lui à l'étape « Recette ».

### 5.3 Points de vigilance

Zéro à trois messages, générés par des règles déterministes (pas de LLM), formulés en
langage clair, chacun avec **une** action. Ordre de priorité décroissant ; on n'affiche
que les trois premières règles satisfaites.

| # | Condition | Message | Action |
|---|---|---|---|
| 1 | `overdueCount > 0` | « **N tâches** ont dépassé leur date. » | Voir les retards |
| 2 | `tasks.length > 0` et aucune tâche n'a de `due_date` | « Aucune de vos tâches n'a de date. Difficile de savoir ce qui vient ensuite. » | Planifier (→ Agenda) |
| 3 | `tasks.length === 0` | « Ce projet n'a pas encore de plan d'action. » | Demander un plan à Clara |
| 4 | Aucune activité (session ou tâche) depuis > 14 jours | « Ce projet est en pause depuis N jours. » | Reprendre une session |
| 5 | `progress === 100` et étape ≠ `maintenance` | « Toutes vos tâches sont faites. Prêt à passer à l'étape suivante ? » | Passer à *étape suivante* |
| 6 | Étape ≥ `dev` et `progress === 0` avec ≥ 5 tâches | « Vous êtes en *Développement* mais aucune tâche n'est terminée. » | Voir les tâches |

Deux niveaux visuels seulement : **attention** (ambre `#D97706`, règles 1/4/6) et
**information** (bleu `C.navy`, règles 2/3/5). Pas de rouge : le rouge est réservé au
compteur de retards, pour ne pas banaliser l'alarme.

Aucune règle satisfaite → le bloc disparaît entièrement (pas de « tout va bien » — c'est
du bruit).

### 5.4 Prochaines échéances

Les **5 prochaines** tâches non terminées ayant une date, triées par `compareTasks()`
(retards en tête, puis échéance la plus proche).

Chaque ligne : pastille de statut, intitulé, badge d'échéance via `dueDateMeta()`
(« Retard · 12 juil », « Aujourd'hui », « Demain », « 3 août »), badge de priorité si
`high`. Clic → ouvre la `TaskDetailModal` existante.

Pied de bloc : `Voir les N autres` → onglet `Tâches`.

Vide → « Aucune échéance planifiée. Ajoutez des dates à vos tâches pour voir ce qui
arrive. »

### 5.5 Activité récente

Flux fusionné des **6 derniers événements** du projet, chacun avec un horodatage relatif
(`formatRelative()` de [lib/format.ts](../../lib/format.ts)) :

- Session mise à jour → « Échange avec **Clara** — *titre de la session* »
- Tâche terminée (`completed_at`) → « Tâche terminée — *intitulé* »
- Tâche créée (`created_at`) → « Tâche ajoutée — *intitulé* »
- Changement d'étape → **non disponible** : `projects` ne conserve pas d'historique
  d'étape. Hors périmètre v1 (voir §9).

Purement en lecture, sauf les sessions (clic → ouvre la session).

### 5.6 Glossaire du projet

Les **6 termes les plus récents** de `project.glossary`, en cartes compactes
(terme en gras + définition). Bouton `Afficher les N termes` pour déplier la liste
complète en place.

Le bloc reste sur la vue d'ensemble (et non dans un onglet dédié) : c'est de la matière
de lecture consultée *en même temps* que le reste, pas un espace de travail. Masqué si le
glossaire est vide.

### 5.7 Carte « Où en est mon projet ? » (synthèse IA)

Voir §6 — c'est le bloc le plus riche, détaillé à part.

### 5.8 État « projet vierge »

Si le projet n'a **ni tâche ni session**, la vue d'ensemble remplace les blocs 5.1 / 5.3 /
5.4 / 5.5 par une carte d'amorçage unique :

> **Votre projet est créé. Et maintenant ?**
> Démarrez une session avec **Clara, cheffe de projet** : elle vous posera quelques
> questions et vous proposera un premier plan d'action, converti en tâches.
> `[ Démarrer avec Clara ]`

Les cartes « Étape en cours » et « Synthèse » restent affichées (la synthèse étant alors
désactivée, cf. §6).

## 6. Synthèse IA — « Où en est mon projet ? »

### 6.1 Comportement

- État initial : carte avec un titre, une phrase d'explication (« Clara relit vos tâches,
  vos échanges et votre étape, et vous fait un point en clair. ») et un bouton
  `Faire le point`.
- Pendant la génération : bouton désactivé + indicateur, avec le nom du modèle réellement
  utilisé (règle produit : l'UI nomme toujours le provider réel).
- Après : le texte, puis en pied de carte `Établi il y a 2 jours · Mistral (local)` et un
  bouton `Refaire le point`.
- Si le projet a changé depuis la génération (une tâche créée / terminée / une session
  mise à jour après `generated_at`), un badge discret `Peut être obsolète` apparaît à côté
  de la date.
- **Jamais de génération automatique** au chargement de la page.
- Bouton désactivé (avec explication) si le projet n'a ni tâche ni session : il n'y a
  rien à synthétiser.

### 6.2 Contenu attendu du texte

Rédigé par **Clara (agent `pm`)**, en vouvoiement, 4 à 6 phrases, en prose continue :

1. Où en est le projet (étape + avancement, formulé sans chiffre brut).
2. Ce qui a avancé récemment.
3. Ce qui bloque ou traîne (retards, tâches sans date).
4. Les deux ou trois prochaines actions concrètes recommandées.

Contraintes de prompt :

- **Aucune section** `LIVRABLES:` / `TÂCHES:` / `LEXIQUE:` — c'est un texte, pas un tour
  de chat. Le parseur n'est pas sollicité.
- **Aucun terme technique nouveau.** Les termes déjà présents dans `projects.glossary`
  sont réutilisables ; tout autre jargon est interdit. On réutilise
  `buildKnownTermsInstruction()` en inversant sa consigne.
- Interdiction d'inventer : la synthèse ne parle que de ce qui est dans les données
  fournies (même règle d'ancrage que `ARTIFACTS_FORMAT_PROMPT`).

### 6.3 Contrat d'API

`POST /api/project-summary` — corps `{ projectId: string }`

| Cas | Code | Réponse |
|---|---|---|
| OK | 200 | `{ text, provider, providerLabel, generated_at }` |
| `projectId` manquant | 400 | `{ error }` |
| Non authentifié | 401 | `{ error }` |
| Projet inexistant ou n'appartenant pas à l'utilisateur | 404 | `{ error }` |
| Moins de 60 s depuis la dernière génération de **ce** projet | 429 | `{ error }` |
| LLM injoignable | 503 | `{ error: describeLLMError(e) }` |

- Réponse **non streamée** (`callChatModel`) : le texte est court, le streaming
  n'apporterait qu'une complexité d'UI.
- Le serveur recharge lui-même projet + tâches + sessions (jamais de données envoyées par
  le client, qui pourrait mentir sur l'état).
- Le prompt est construit à partir de `buildSystemPrompt("pm", …)` +
  `buildProjectStateInstruction()` (déjà existant, déjà testé) + un bloc « activité
  récente » + la consigne de format ci-dessus.
- BYOK respecté comme dans `/api/chat` (`loadUserByokConfig`).

### 6.4 Persistance

Nouvelle colonne sur `projects`, via une **migration isolée** (cf. le piège documenté :
`schema.sql` n'est pas la source de vérité et une migration passée a déjà droppé la table
`projects` en production) :

```sql
-- supabase/migrations/2026-07-28-project-summary.sql
alter table public.projects
  add column if not exists summary jsonb;
```

Forme stockée :

```jsonc
{
  "text": "Votre projet avance bien…",
  "provider": "local",
  "providerLabel": "Mistral (local)",
  "generated_at": "2026-07-28T10:12:00.000Z"
}
```

Une seule synthèse conservée par projet (la dernière écrase la précédente). Pas
d'historique : personne ne veut relire ses vieux points de situation.

## 7. Données et performance

- Les tâches passent **exclusivement** par `useTasks({ projectId })` — le cache SWR
  partagé. Aucun fetch de tâches propre au dashboard (règle établie du projet).
- Les sessions et le projet sont déjà chargés par `ProjectDetailScreen` ; les trois
  onglets se partagent ce chargement — **changer d'onglet ne déclenche aucune requête**.
- Tous les calculs du dashboard sont des dérivations mémoïsées de ces deux tableaux.
  Sur un projet réaliste (< 200 tâches, < 50 sessions), le coût est négligeable.
- Le seul appel réseau propre au dashboard est la génération de synthèse, sur clic.

## 8. Impacts techniques

**Nouveaux fichiers**

| Fichier | Rôle |
|---|---|
| `lib/project-dashboard.ts` | Logique pure : KPI, règles de vigilance, prochaines échéances, flux d'activité, détection d'obsolescence de la synthèse. **Sans JSX**, sur le modèle de `lib/tasks.ts` |
| `lib/project-dashboard.test.ts` | Tests unitaires des règles ci-dessus |
| `components/ProjectOverviewTab.tsx` | Rendu de la vue d'ensemble |
| `app/api/project-summary/route.ts` | Génération de la synthèse |
| `app/api/project-summary/route.test.ts` | Auth, 404, rate limit, repli provider |
| `supabase/migrations/2026-07-28-project-summary.sql` | `ALTER TABLE` isolé |

**Fichiers modifiés**

- `components/ProjectDetailScreen.tsx` — introduit les onglets et **extrait** le board de
  tâches existant dans `components/ProjectTasksTab.tsx` et la liste des sessions dans
  `components/ProjectSessionsTab.tsx`. Extraction mécanique (déplacement de code), pas de
  réécriture : la page passe d'environ 1040 lignes à environ 250.
- `lib/projects.ts` — ajout de `description` sur `Stage`, du champ `summary` sur `Project`
  et du type `ProjectSummary`.
- `app/(authenticated)/projects/[id]/page.tsx` — lecture du paramètre `?tab=`.

**Aucun impact** sur : le parseur de réponses, le flux de chat, l'agenda, la bibliothèque,
le cache de tâches.

## 9. Hors périmètre (v1)

- **Graphes** (courbe d'avancement, burn-down, répartition par agent). Sur des projets de
  20 à 40 tâches, un graphe apporte moins qu'une phrase. À reconsidérer si des projets
  dépassent 100 tâches.
- **Historique des changements d'étape** (nécessiterait une table d'événements).
- **Dashboard transversal multi-projets** sur `/home`.
- **Export PDF / Word du dashboard** (la bibliothèque couvre déjà l'export des livrables).
- **Vélocité et estimation de date de fin** : aucune donnée d'effort n'est saisie, toute
  projection serait de la fiction.

## 10. Critères d'acceptation

1. Ouvrir un projet affiche la vue d'ensemble ; les tâches restent accessibles en un clic
   et le board conserve exactement ses fonctionnalités actuelles.
2. Les quatre KPI correspondent aux données réelles ; « En retard » et « Cette semaine »
   donnent les mêmes nombres que les chips de l'onglet `Tâches`.
3. Cliquer « En retard » ouvre l'onglet `Tâches` avec le filtre `overdue` déjà appliqué.
4. Un projet avec 3 tâches en retard affiche le point de vigilance correspondant ; un
   projet sain n'affiche aucun bloc de vigilance.
5. Un projet vide affiche la carte d'amorçage, et non des tuiles à zéro.
6. `Faire le point` produit un texte en français, sans section ni jargon non expliqué, et
   la carte indique le provider réellement utilisé.
7. La synthèse survit à un rechargement de page ; modifier une tâche fait apparaître le
   badge « Peut être obsolète ».
8. Ollama arrêté et sans clé cloud → message d'erreur explicite, le reste du dashboard
   reste fonctionnel.
9. Changer d'onglet ne déclenche aucune requête réseau.
10. `npm run typecheck` et `npm test` passent.

## 11. Points à trancher

1. **Fusionner « Sessions » dans la vue d'ensemble ?** Un projet a souvent 2 ou 3
   sessions ; un onglet entier pour trois lignes est peut-être excessif. Alternative :
   2 onglets (`Vue d'ensemble` / `Tâches`) et les sessions en bloc de la vue d'ensemble.
2. **Seuil d'inactivité** : 14 jours est une hypothèse. Sur des projets menés en soirée
   et le week-end, 21 ou 30 jours serait peut-être plus juste.
3. **Rédacteur de la synthèse** : Clara (`pm`) est le choix naturel. Sam (`teacher`)
   produirait un texte plus pédagogique mais moins orienté pilotage.
