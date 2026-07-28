import { vi } from "vitest";
import type { Task } from "@/lib/data";
import type { UseTasksResult } from "@/lib/use-tasks";

// Simule intégralement `useTasks` pour les tests de composant : les tâches sont
// fournies telles quelles et chaque mutation est un `vi.fn()` sur lequel le test
// assert. Aucun SWR, aucun Supabase, rien d'asynchrone à attendre — les tests
// restent synchrones et déterministes.
//
// `over` permet de surcharger une mutation au cas par cas, typiquement `addTask`
// dont le composant lit la valeur de retour (le champ n'est vidé que si la
// création a réussi).
export function makeUseTasks(
  tasks: Task[] = [],
  over: Partial<UseTasksResult> = {},
): UseTasksResult {
  return {
    tasks,
    loading: false,
    refresh: vi.fn(),
    addTask: vi.fn(async () => null),
    cycleStatus: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    removeTask: vi.fn(async () => {}),
    setPriority: vi.fn(async () => {}),
    setDueDate: vi.fn(async () => {}),
    setStartDate: vi.fn(async () => {}),
    setContent: vi.fn(async () => {}),
    shiftDates: vi.fn(async () => {}),
    addComment: vi.fn(async () => {}),
    editComment: vi.fn(async () => {}),
    deleteComment: vi.fn(async () => {}),
    ...over,
  };
}

// Fabrique de tâche : seuls les champs pertinents au test sont surchargés.
export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    session_id: null,
    project_id: "p1",
    content: "Tâche",
    status: "todo",
    priority: "normal",
    start_date: null,
    due_date: null,
    source_agent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    completed_at: null,
    comments: [],
    ...over,
  };
}
