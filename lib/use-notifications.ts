"use client";

// Données de dismissal des notifications de tâches (échéances vues/ignorées).
// Module séparé de use-tasks.ts car consommé directement par AppDataProvider
// (même pattern que fetchAllTasks/TASKS_KEY) — pas de hook React dédié : la
// donnée combinée (tâches + dismissals) vit dans le contexte applicatif.
import { TaskDismissal } from "./tasks";
import { createClient } from "./supabase/client";

export const DISMISSALS_KEY = "task_notification_dismissals";

// Client navigateur réutilisé (même pattern que lib/use-tasks.ts).
let browserClient: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!browserClient) browserClient = createClient();
  return browserClient;
}

export async function fetchDismissals(): Promise<TaskDismissal[]> {
  const { data } = await getSupabase()
    .from("task_notification_dismissals")
    .select("task_id, due_date");
  return (data ?? []) as TaskDismissal[];
}

export async function insertDismissal(taskId: string, dueDate: string): Promise<void> {
  const {
    data: { user },
  } = await getSupabase().auth.getUser();
  if (!user) return;
  await getSupabase()
    .from("task_notification_dismissals")
    .upsert(
      { user_id: user.id, task_id: taskId, due_date: dueDate },
      { onConflict: "user_id,task_id,due_date" },
    );
}
