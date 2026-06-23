"use client";

// Hook unique de gestion des tâches, partagé par les écrans Tâches, Projet et
// Agenda. Avant : chaque écran refaisait son propre fetch Supabase et redéfinissait
// les mêmes mutations (cycleStatus, setPriority, setDueDate…) — ~100 lignes
// dupliquées 3×. Ici une seule clé SWR `"tasks"` met en cache TOUTES les tâches
// de l'utilisateur : les trois écrans partagent ce cache (un seul fetch réseau)
// et toute mutation se propage instantanément à tous via le cache SWR.
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { addDaysYmd, NEXT_STATUS } from "./tasks";
import { Task, TaskPriority, TaskStatus } from "./data";
import { createClient } from "./supabase/client";

const TASK_COLS =
  "id, session_id, project_id, content, status, priority, start_date, due_date, source_agent_id, created_at, completed_at";

// Clé SWR globale : tous les consommateurs partagent le même cache.
export const TASKS_KEY = "tasks";

// Client navigateur réutilisé (évite d'en recréer un par composant/rendu).
let browserClient: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!browserClient) browserClient = createClient();
  return browserClient;
}

export async function fetchAllTasks(): Promise<Task[]> {
  const { data } = await getSupabase()
    .from("tasks")
    .select(TASK_COLS)
    .order("created_at", { ascending: false });
  return (data ?? []) as Task[];
}

export interface NewTaskInput {
  content: string;
  due_date?: string | null;
  start_date?: string | null;
  project_id?: string | null;
}

export interface UseTasksResult {
  tasks: Task[];
  loading: boolean;
  refresh: () => void;
  addTask: (input: NewTaskInput) => Promise<Task | null>;
  cycleStatus: (task: Task) => Promise<void>;
  setStatus: (task: Task, status: TaskStatus) => Promise<void>;
  removeTask: (task: Task) => Promise<void>;
  setPriority: (task: Task, priority: TaskPriority) => Promise<void>;
  setDueDate: (task: Task, due_date: string | null) => Promise<void>;
  setStartDate: (task: Task, start_date: string | null) => Promise<void>;
  setContent: (task: Task, content: string) => Promise<void>;
  // Décale start ET due (celles présentes) du même nombre de jours (drag timeline).
  shiftDates: (task: Task, deltaDays: number) => Promise<void>;
}

/**
 * @param scope.projectId — si fourni, `tasks` ne contient que les tâches de ce
 *   projet (filtrage côté client sur le cache global) et `addTask` rattache la
 *   nouvelle tâche à ce projet par défaut.
 */
export function useTasks(scope?: { projectId?: string | null }): UseTasksResult {
  const projectId = scope?.projectId ?? null;
  const { data, isLoading, mutate } = useSWR<Task[]>(TASKS_KEY, fetchAllTasks);
  const supabase = getSupabase();

  const all = data ?? [];
  const tasks = useMemo(
    () => (projectId ? all.filter((t) => t.project_id === projectId) : all),
    [all, projectId],
  );

  // Patch optimiste d'une tâche + persistance ; rollback automatique si la
  // requête échoue. `revalidate: false` : on fait confiance à la mise à jour
  // locale plutôt que de refetch toute la liste.
  const patchTask = useCallback(
    (id: string, fields: Partial<Task>, persist: () => PromiseLike<unknown>) => {
      const apply = (list: Task[] = []) => list.map((t) => (t.id === id ? { ...t, ...fields } : t));
      return mutate(
        async (cur = []) => {
          await persist();
          return apply(cur);
        },
        { optimisticData: apply, rollbackOnError: true, revalidate: false },
      ).then(() => undefined);
    },
    [mutate],
  );

  const addTask = useCallback(
    async (input: NewTaskInput): Promise<Task | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: row, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          content: input.content,
          status: "todo",
          due_date: input.due_date ?? null,
          start_date: input.start_date ?? null,
          project_id: input.project_id ?? projectId,
        })
        .select(TASK_COLS)
        .single();
      if (error || !row) return null;
      const created = row as Task;
      await mutate((cur = []) => [created, ...cur], { revalidate: false });
      return created;
    },
    [mutate, supabase, projectId],
  );

  const setStatus = useCallback(
    (task: Task, status: TaskStatus) => {
      if (task.status === status) return Promise.resolve();
      const completed_at = status === "done" ? new Date().toISOString() : null;
      return patchTask(task.id, { status, completed_at }, () =>
        supabase.from("tasks").update({ status, completed_at }).eq("id", task.id),
      );
    },
    [patchTask, supabase],
  );

  const cycleStatus = useCallback(
    (task: Task) => setStatus(task, NEXT_STATUS[task.status]),
    [setStatus],
  );

  const removeTask = useCallback(
    (task: Task) => {
      const apply = (list: Task[] = []) => list.filter((t) => t.id !== task.id);
      return mutate(
        async (cur = []) => {
          await supabase.from("tasks").delete().eq("id", task.id);
          return apply(cur);
        },
        { optimisticData: apply, rollbackOnError: true, revalidate: false },
      ).then(() => undefined);
    },
    [mutate, supabase],
  );

  const setPriority = useCallback(
    (task: Task, priority: TaskPriority) => {
      if (task.priority === priority) return Promise.resolve();
      return patchTask(task.id, { priority }, () =>
        supabase.from("tasks").update({ priority }).eq("id", task.id),
      );
    },
    [patchTask, supabase],
  );

  const setDueDate = useCallback(
    (task: Task, due_date: string | null) =>
      patchTask(task.id, { due_date }, () =>
        supabase.from("tasks").update({ due_date }).eq("id", task.id),
      ),
    [patchTask, supabase],
  );

  const setStartDate = useCallback(
    (task: Task, start_date: string | null) =>
      patchTask(task.id, { start_date }, () =>
        supabase.from("tasks").update({ start_date }).eq("id", task.id),
      ),
    [patchTask, supabase],
  );

  const setContent = useCallback(
    (task: Task, content: string) => {
      if (content === task.content) return Promise.resolve();
      return patchTask(task.id, { content }, () =>
        supabase.from("tasks").update({ content }).eq("id", task.id),
      );
    },
    [patchTask, supabase],
  );

  const shiftDates = useCallback(
    (task: Task, deltaDays: number) => {
      const shift = (d: string | null) => (d ? addDaysYmd(d, deltaDays) : null);
      const start_date = shift(task.start_date);
      const due_date = shift(task.due_date);
      return patchTask(task.id, { start_date, due_date }, () =>
        supabase.from("tasks").update({ start_date, due_date }).eq("id", task.id),
      );
    },
    [patchTask, supabase],
  );

  return {
    tasks,
    loading: isLoading,
    refresh: () => void mutate(),
    addTask,
    cycleStatus,
    setStatus,
    removeTask,
    setPriority,
    setDueDate,
    setStartDate,
    setContent,
    shiftDates,
  };
}
