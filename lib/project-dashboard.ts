// Logique du tableau de bord d'un projet, sans JSX — même esprit que lib/tasks.ts.
//
// Tout est DÉRIVÉ des données déjà chargées par l'écran projet (le projet, ses
// tâches via le cache SWR partagé, ses sessions) : aucun calcul serveur, aucune
// requête propre au dashboard. Une seule fonction d'entrée, `buildDashboard`,
// pour un seul useMemo côté composant et un seul point d'entrée de test.
//
// Les actions ne sont PAS des callbacks : ce module ne connaît ni le routeur ni
// les écrans. Il renvoie des INTENTIONS (`DashboardAction`) que le composant
// traduit en navigation.
import { AGENTS, AgentId, Task } from "./data";
import { computeStats, Project, ProjectSessionRow, StageId, stageIndex, nextStage, stageMeta } from "./projects";
import { compareTasks, filterCounts, TaskFilter } from "./tasks";

// Au-delà de ce silence, on considère que le projet est en pause. 21 jours
// plutôt que 14 : la cible mène ses projets le soir et le week-end, et une
// alerte qui a souvent tort finit par ne plus être lue.
export const IDLE_DAYS = 21;
export const MAX_ALERTS = 3;
export const MAX_UPCOMING = 5;
export const MAX_ACTIVITY = 6;
// En deçà, « aucune tâche terminée » ne veut rien dire : le projet démarre.
export const STALLED_MIN_TASKS = 5;

export type DashboardAction =
  | { kind: "tasks"; filter: TaskFilter }
  | { kind: "agenda" }
  | { kind: "newSession"; agentId: AgentId }
  | { kind: "nextStage"; stage: StageId };

export type AlertId = "overdue" | "nodates" | "noplan" | "idle" | "allDone" | "stalled";

export interface DashboardAlert {
  id: AlertId;
  // Deux niveaux seulement. Pas de rouge : il est réservé au compteur de
  // retards, pour ne pas banaliser l'alarme.
  level: "warn" | "info";
  message: string;
  actionLabel: string;
  action: DashboardAction;
}

export interface ActivityItem {
  id: string;
  kind: "session" | "taskDone" | "taskCreated";
  label: string;
  detail: string;
  ts: string;
  // Présent uniquement sur les sessions : seules elles sont cliquables.
  sessionId?: string;
}

export interface DashboardKpis {
  // null quand le projet n'a aucune tâche : l'UI affiche « — ». 0 % serait
  // décourageant et faux — rien n'a été planifié, ce n'est pas rien de fait.
  progress: number | null;
  done: number;
  total: number;
  overdue: number;
  week: number;
  deliverables: number;
}

export interface Dashboard {
  kpis: DashboardKpis;
  alerts: DashboardAlert[];
  upcoming: Task[];
  activity: ActivityItem[];
  isBlank: boolean;
  summaryStale: boolean;
}

// Dernier signe de vie du projet, toutes sources confondues. null si le projet
// est vide (la règle d'inactivité ne se déclenche alors pas).
function lastActivityAt(tasks: Task[], sessions: ProjectSessionRow[]): string | null {
  let max: string | null = null;
  const keep = (ts: string | null | undefined) => {
    if (ts && (max === null || ts > max)) max = ts;
  };
  for (const t of tasks) {
    keep(t.created_at);
    keep(t.updated_at);
  }
  for (const s of sessions) keep(s.updated_at);
  return max;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function buildAlerts(input: {
  project: Project;
  tasks: Task[];
  sessions: ProjectSessionRow[];
  kpis: DashboardKpis;
}): DashboardAlert[] {
  const { project, tasks, sessions, kpis } = input;
  const all: DashboardAlert[] = [];

  // L'ordre de construction EST l'ordre de priorité : on tronque à la fin.
  if (kpis.overdue > 0) {
    all.push({
      id: "overdue",
      level: "warn",
      message:
        kpis.overdue === 1
          ? "1 tâche a dépassé sa date."
          : `${kpis.overdue} tâches ont dépassé leur date.`,
      actionLabel: "Voir les retards",
      action: { kind: "tasks", filter: "overdue" },
    });
  }

  if (tasks.length > 0 && tasks.every((t) => !t.due_date)) {
    all.push({
      id: "nodates",
      level: "info",
      message: "Aucune de vos tâches n'a de date. Difficile de savoir ce qui vient ensuite.",
      actionLabel: "Planifier",
      action: { kind: "agenda" },
    });
  }

  if (tasks.length === 0) {
    all.push({
      id: "noplan",
      level: "info",
      message: "Ce projet n'a pas encore de plan d'action.",
      actionLabel: "Demander un plan à Clara",
      action: { kind: "newSession", agentId: "pm" },
    });
  }

  const last = lastActivityAt(tasks, sessions);
  if (last) {
    const days = daysSince(last);
    if (days >= IDLE_DAYS) {
      all.push({
        id: "idle",
        level: "warn",
        message: `Ce projet est en pause depuis ${days} jours.`,
        actionLabel: "Reprendre une session",
        action: { kind: "newSession", agentId: "pm" },
      });
    }
  }

  const next = nextStage(project.stage);
  if (kpis.progress === 100 && next) {
    all.push({
      id: "allDone",
      level: "info",
      message: "Toutes vos tâches sont faites. Prêt à passer à l'étape suivante ?",
      actionLabel: `Passer à : ${next.name}`,
      action: { kind: "nextStage", stage: next.id },
    });
  }

  // « dev » est la 3e étape (index 2) : à partir de là, ne rien avoir terminé
  // sur un lot de tâches déjà consistant mérite d'être dit.
  if (stageIndex(project.stage) >= 2 && kpis.progress === 0 && kpis.total >= STALLED_MIN_TASKS) {
    all.push({
      id: "stalled",
      level: "warn",
      message: `Vous êtes en ${stageMeta(project.stage).name} mais aucune tâche n'est terminée.`,
      actionLabel: "Voir les tâches",
      action: { kind: "tasks", filter: "all" },
    });
  }

  return all.slice(0, MAX_ALERTS);
}

function buildActivity(tasks: Task[], sessions: ProjectSessionRow[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const s of sessions) {
    const isPanel = Array.isArray(s.panel_agent_ids) && s.panel_agent_ids.length > 1;
    const agent = AGENTS[s.agent_id];
    items.push({
      id: `session:${s.id}`,
      kind: "session",
      label: isPanel
        ? `Panel · ${s.panel_agent_ids!.length} agents`
        : `Échange avec ${agent?.firstName ?? "un agent"}`,
      detail: s.title ?? "Nouvelle session",
      ts: s.updated_at,
      sessionId: s.id,
    });
  }

  for (const t of tasks) {
    if (t.completed_at) {
      items.push({
        id: `done:${t.id}`,
        kind: "taskDone",
        label: "Tâche terminée",
        detail: t.content,
        ts: t.completed_at,
      });
    }
    items.push({
      id: `created:${t.id}`,
      kind: "taskCreated",
      label: "Tâche ajoutée",
      detail: t.content,
      ts: t.created_at,
    });
  }

  return items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, MAX_ACTIVITY);
}

export function buildDashboard(input: {
  project: Project;
  tasks: Task[];
  sessions: ProjectSessionRow[];
}): Dashboard {
  const { project, tasks, sessions } = input;

  const done = tasks.filter((t) => t.status === "done").length;
  // Les compteurs passent par filterCounts : les tuiles et les chips du board
  // affichent ainsi les mêmes nombres par construction, pas par coïncidence.
  const counts = filterCounts(tasks);

  const kpis: DashboardKpis = {
    progress: tasks.length === 0 ? null : Math.round((done / tasks.length) * 100),
    done,
    total: tasks.length,
    overdue: counts.overdue,
    week: counts.week,
    deliverables: computeStats(sessions, done).deliverablesCount,
  };

  const summary = project.summary ?? null;
  const last = lastActivityAt(tasks, sessions);

  return {
    kpis,
    alerts: buildAlerts({ project, tasks, sessions, kpis }),
    upcoming: tasks
      .filter((t) => t.status !== "done" && t.due_date)
      .sort(compareTasks)
      .slice(0, MAX_UPCOMING),
    activity: buildActivity(tasks, sessions),
    isBlank: tasks.length === 0 && sessions.length === 0,
    summaryStale: Boolean(summary && last && last > summary.generated_at),
  };
}
