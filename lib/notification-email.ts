// Formatage de l'email d'alerte quotidien des notifications de tâches.
// Logique pure (pas d'I/O) — réutilisée par l'Edge Function
// supabase/functions/notify-pending-tasks/index.ts.

export type NotificationUrgency = "overdue" | "today" | "tomorrow";

export interface EmailNotificationTask {
  content: string;
  due_date: string;
  urgency: NotificationUrgency;
}

const URGENCY_ORDER: Record<NotificationUrgency, number> = {
  overdue: 0,
  today: 1,
  tomorrow: 2,
};

const URGENCY_LABEL: Record<NotificationUrgency, string> = {
  overdue: "⚠️ En retard",
  today: "📅 Aujourd'hui",
  tomorrow: "📅 Demain",
};

export function sortByUrgency(tasks: EmailNotificationTask[]): EmailNotificationTask[] {
  return [...tasks].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
}

function formatDueDate(ymd: string): string {
  const [, month, day] = ymd.split("-");
  return `${day}/${month}`;
}

export function buildEmailSubject(tasks: EmailNotificationTask[]): string {
  return `Fondio — ${tasks.length} tâche(s) à traiter`;
}

export function buildEmailBody(tasks: EmailNotificationTask[], agendaUrl: string): string {
  const lines = sortByUrgency(tasks).map(
    (t) => `${URGENCY_LABEL[t.urgency]} : ${t.content} (échéance ${formatDueDate(t.due_date)})`
  );
  return [
    `Vous avez ${tasks.length} tâche(s) qui réclament votre attention :`,
    "",
    ...lines,
    "",
    `→ Voir dans l'agenda : ${agendaUrl}`,
  ].join("\n");
}
