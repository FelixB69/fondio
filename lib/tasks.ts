// Logique métier partagée des tâches (sans JSX). Source de vérité unique pour
// les écrans Tâches, Projet et Agenda : tri, filtres, échéances, regroupements.
import { Task, TaskComment, TaskPriority, TaskStatus } from "./data";
import { C } from "./design-tokens";
import type { IconName } from "@/components/Icon";

// ---------------------------------------------------------------------------
// Métadonnées d'affichage par statut / priorité
// ---------------------------------------------------------------------------

export const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  todo: { label: "À faire", color: C.navy, bg: C.navyLight },
  doing: { label: "En cours", color: "#D97706", bg: "#FFFBEB" },
  done: { label: "Fait", color: "#0E9F88", bg: "#EDFAF7" },
};

export const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "done"];

// `normal` = null → aucun badge (réduit le bruit visuel).
export const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string } | null> = {
  low: { label: "Basse", color: C.textMute, bg: C.bg },
  normal: null,
  high: { label: "Haute", color: "#DC2626", bg: "#FEF2F2" },
};

// Rang de tri : plus petit = plus haut dans la liste.
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

// ---------------------------------------------------------------------------
// Helpers de date — tout en "YYYY-MM-DD" heure LOCALE (jamais UTC), pour
// pouvoir comparer directement à due_date par simple comparaison de chaînes.
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Parse une chaîne "YYYY-MM-DD" en Date LOCALE (minuit local). À utiliser
// partout plutôt que `new Date(str)` qui interprète en UTC et décale le jour.
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr(): string {
  return ymd(new Date());
}

export function inDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Décale une date "YYYY-MM-DD" de n jours (n peut être négatif), renvoie "YYYY-MM-DD".
export function addDaysYmd(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Nombre de jours entiers de `a` à `b` (b - a). Positif si b est après a.
export function diffDaysYmd(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

// Liste inclusive des jours de `from` à `to` (axe de la timeline).
export function eachDayYmd(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cur = from; cur <= to; cur = addDaysYmd(cur, 1)) days.push(cur);
  return days;
}

// Lundi (00:00 local) de la semaine contenant `s`, au format "YYYY-MM-DD".
export function startOfWeekYmd(s: string): string {
  const d = parseYmd(s);
  // getDay() : 0 = dimanche … 6 = samedi. On veut reculer jusqu'au lundi.
  const offset = (d.getDay() + 6) % 7;
  return addDaysYmd(s, -offset);
}

// Plage affichable d'une tâche sur la timeline :
//   - start_date + due_date → [start, end] (end >= start garanti)
//   - une seule des deux dates → journée unique
//   - aucune date → null (la tâche n'a pas sa place sur la timeline)
export function taskBounds(task: Task): { start: string; end: string } | null {
  const a = task.start_date;
  const b = task.due_date;
  if (a && b) return a <= b ? { start: a, end: b } : { start: b, end: a };
  if (b) return { start: b, end: b };
  if (a) return { start: a, end: a };
  return null;
}

// ---------------------------------------------------------------------------
// Commentaires : tri plus-récent-en-premier, sans muter le tableau d'origine.
// ---------------------------------------------------------------------------

export function sortedComments(task: Task): TaskComment[] {
  return [...task.comments].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Tri d'une colonne : échéance (datées avant non datées, plus proche d'abord →
// retards en haut) → priorité → création la plus récente.
// ---------------------------------------------------------------------------

export function compareTasks(a: Task, b: Task): number {
  if (a.due_date && b.due_date) {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  } else if (a.due_date) {
    return -1;
  } else if (b.due_date) {
    return 1;
  }
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }
  return a.created_at < b.created_at ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Filtres (chips) : Toutes / En retard / Cette semaine / Priorité haute
// ---------------------------------------------------------------------------

export type TaskFilter = "all" | "overdue" | "week" | "high";

export const FILTERS: Array<{ id: TaskFilter; label: string; icon?: IconName }> = [
  { id: "all", label: "Toutes" },
  { id: "overdue", label: "En retard", icon: "warning" },
  { id: "week", label: "Cette semaine", icon: "clock" },
  { id: "high", label: "Priorité haute" },
];

// Les filtres temporels ignorent les tâches `done` (une tâche faite n'est plus
// "en retard" ni "à venir").
export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "high") return task.priority === "high";
  if (task.status === "done" || !task.due_date) return false;
  if (filter === "overdue") return task.due_date < todayStr();
  if (filter === "week") return task.due_date >= todayStr() && task.due_date <= inDaysStr(7);
  return true;
}

// Compteurs des chips — toujours calculés sur l'ensemble complet, indépendamment
// du filtre actif (sinon les pastilles sauteraient à chaque clic).
export function filterCounts(tasks: Task[]): Record<TaskFilter, number> {
  const c: Record<TaskFilter, number> = { all: tasks.length, overdue: 0, week: 0, high: 0 };
  for (const t of tasks) {
    if (matchesFilter(t, "overdue")) c.overdue++;
    if (matchesFilter(t, "week")) c.week++;
    if (matchesFilter(t, "high")) c.high++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Échéance → label + couleur selon l'urgence. Parse en date LOCALE pour éviter
// les décalages de fuseau. Une tâche `done` n'est jamais "en retard".
// ---------------------------------------------------------------------------

export function dueDateMeta(dueDate: string, done: boolean): { label: string; color: string; bg: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseYmd(dueDate);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);

  const short = due.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  if (done) return { label: short, color: C.textMute, bg: C.bg };

  let label: string;
  if (diff === 0) label = "Aujourd'hui";
  else if (diff === 1) label = "Demain";
  else if (diff === -1) label = "Hier";
  else if (diff < 0) label = `Retard · ${short}`;
  else label = short;

  if (diff < 0) return { label, color: "#DC2626", bg: "#FEF2F2" };
  if (diff <= 1) return { label, color: "#D97706", bg: "#FFFBEB" };
  return { label, color: C.textSub, bg: C.bg };
}

// ---------------------------------------------------------------------------
// Agenda transversal : regroupement par horizon temporel.
// ---------------------------------------------------------------------------

export type AgendaBucket = "overdue" | "today" | "week" | "later" | "nodate";

export const AGENDA_BUCKETS: Array<{ id: AgendaBucket; label: string; icon: IconName; color: string }> = [
  { id: "overdue", label: "En retard", icon: "warning", color: "#DC2626" },
  { id: "today", label: "Aujourd'hui", icon: "target", color: "#D97706" },
  { id: "week", label: "Cette semaine", icon: "clock", color: C.navy },
  { id: "later", label: "Plus tard", icon: "rocket", color: C.textSub },
  { id: "nodate", label: "Sans échéance", icon: "tasks", color: C.textMute },
];

// Renvoie le bucket d'une tâche, ou null si elle ne doit pas apparaître à
// l'agenda (tâches déjà faites — l'agenda regarde devant, pas derrière).
export function agendaBucket(task: Task): AgendaBucket | null {
  if (task.status === "done") return null;
  if (!task.due_date) return "nodate";
  const today = todayStr();
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "today";
  if (task.due_date <= inDaysStr(7)) return "week";
  return "later";
}

// ---------------------------------------------------------------------------
// Filtres de l'agenda : projet / agent / recherche texte / inclure les faites.
// Partagé par la barre de filtres et les deux vues (timeline + liste).
// ---------------------------------------------------------------------------

export interface AgendaFilters {
  query: string;
  projectId: string | null; // null = tous les projets
  agentId: string | null; // null = tous les agents
  showDone: boolean; // false = on masque les tâches terminées
}

export const EMPTY_AGENDA_FILTERS: AgendaFilters = {
  query: "",
  projectId: null,
  agentId: null,
  showDone: false,
};

export function matchesAgenda(task: Task, f: AgendaFilters): boolean {
  if (!f.showDone && task.status === "done") return false;
  if (f.projectId && task.project_id !== f.projectId) return false;
  if (f.agentId && task.source_agent_id !== f.agentId) return false;
  const q = f.query.trim().toLowerCase();
  if (q && !task.content.toLowerCase().includes(q)) return false;
  return true;
}

export function hasActiveFilters(f: AgendaFilters): boolean {
  return f.query.trim() !== "" || f.projectId !== null || f.agentId !== null || f.showDone;
}

// ---------------------------------------------------------------------------
// Notifications : tâches dont l'échéance réclame une attention immédiate
// (retard, aujourd'hui, demain). Le marquage "lu" (dismissal) est attaché au
// couple (task_id, due_date) — si la tâche est repoussée puis redevient due,
// la notification réapparaît automatiquement (la clé ne matche plus).
// ---------------------------------------------------------------------------

export type NotificationUrgency = "overdue" | "today" | "tomorrow";

export interface TaskNotification {
  task: Task;
  urgency: NotificationUrgency;
}

export interface TaskDismissal {
  task_id: string;
  due_date: string;
}

export function pendingNotifications(tasks: Task[], dismissals: TaskDismissal[]): TaskNotification[] {
  const dismissedKeys = new Set(dismissals.map((d) => `${d.task_id}:${d.due_date}`));
  const result: TaskNotification[] = [];

  for (const task of tasks) {
    if (task.status === "done" || !task.due_date) continue;
    const diff = diffDaysYmd(todayStr(), task.due_date);
    const urgency: NotificationUrgency | null = diff < 0 ? "overdue" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : null;
    if (!urgency) continue;
    if (dismissedKeys.has(`${task.id}:${task.due_date}`)) continue;
    result.push({ task, urgency });
  }

  return result.sort((a, b) => compareTasks(a.task, b.task));
}
