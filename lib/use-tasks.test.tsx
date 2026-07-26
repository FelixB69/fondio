// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import type { Task } from "./data";

// « Base » simulée, partagée avec la factory via vi.hoisted. Un builder chaînable
// minimal reproduit le contrat Supabase utilisé par le hook :
//   fetch  : from("tasks").select(COLS).order(...)          → { data: tasks }
//   add    : from("tasks").insert(...).select(COLS).single()→ insertResult
//   patch  : from("tasks").update(...).eq("id", id)         → enregistre updates
//   remove : from("tasks").delete().eq("id", id)            → enregistre deletes
const db = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  tasks: [] as unknown[],
  insertResult: { data: null as unknown, error: null as unknown },
  inserts: [] as unknown[],
  updates: [] as { payload: Record<string, unknown>; id?: string }[],
  deletes: [] as (string | undefined)[],
}));

vi.mock("./supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => {
      const ctx: { op?: string; payload?: Record<string, unknown>; id?: string } = {};
      const q: Record<string, unknown> = {
        select: () => q,
        order: async () => ({ data: db.tasks }),
        insert: (payload: Record<string, unknown>) => {
          ctx.op = "insert";
          ctx.payload = payload;
          return q;
        },
        update: (payload: Record<string, unknown>) => {
          ctx.op = "update";
          ctx.payload = payload;
          return q;
        },
        delete: () => {
          ctx.op = "delete";
          return q;
        },
        eq: (_col: string, val: string) => {
          ctx.id = val;
          return q;
        },
        single: async () => {
          db.inserts.push(ctx.payload);
          return db.insertResult;
        },
        then: (onF: (v: { error: unknown }) => unknown, onR?: (e: unknown) => unknown) => {
          if (ctx.op === "update") db.updates.push({ payload: ctx.payload!, id: ctx.id });
          if (ctx.op === "delete") db.deletes.push(ctx.id);
          return Promise.resolve({ error: null }).then(onF, onR);
        },
      };
      return q;
    },
  }),
}));

import { useTasks } from "./use-tasks";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    session_id: null,
    project_id: null,
    content: "Faire le cadrage",
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

// Wrapper SWR avec cache neuf par test (aucune fuite entre tests).
function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

async function renderTasks(scope?: { projectId?: string | null }) {
  const view = renderHook(() => useTasks(scope), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  db.user = { id: "user-1" };
  db.tasks = [];
  db.insertResult = { data: null, error: null };
  db.inserts = [];
  db.updates = [];
  db.deletes = [];
});

describe("useTasks — lecture", () => {
  it("charge toutes les tâches de l'utilisateur", async () => {
    db.tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const { result } = await renderTasks();
    expect(result.current.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("filtre par projet quand un scope est fourni", async () => {
    db.tasks = [
      makeTask({ id: "a", project_id: "p1" }),
      makeTask({ id: "b", project_id: "p2" }),
      makeTask({ id: "c", project_id: "p1" }),
    ];
    const { result } = await renderTasks({ projectId: "p1" });
    expect(result.current.tasks.map((t) => t.id)).toEqual(["a", "c"]);
  });
});

describe("useTasks — mutations", () => {
  it("addTask renvoie null quand aucun utilisateur", async () => {
    db.user = null;
    const { result } = await renderTasks();
    let created: Task | null = makeTask();
    await act(async () => {
      created = await result.current.addTask({ content: "Nouvelle" });
    });
    expect(created).toBeNull();
    expect(db.inserts).toHaveLength(0);
  });

  it("addTask insère et préfixe la tâche créée dans le cache", async () => {
    const created = makeTask({ id: "new", content: "Nouvelle" });
    db.insertResult = { data: created, error: null };
    db.tasks = [makeTask({ id: "old" })];
    const { result } = await renderTasks();
    await act(async () => {
      await result.current.addTask({ content: "Nouvelle" });
    });
    expect(result.current.tasks.map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("setStatus ne persiste rien si le statut est inchangé", async () => {
    const { result } = await renderTasks();
    const task = makeTask({ status: "todo" });
    await act(async () => {
      await result.current.setStatus(task, "todo");
    });
    expect(db.updates).toHaveLength(0);
  });

  it("setStatus vers done écrit completed_at", async () => {
    db.tasks = [makeTask({ id: "t1", status: "todo" })];
    const { result } = await renderTasks();
    await act(async () => {
      await result.current.setStatus(makeTask({ id: "t1", status: "todo" }), "done");
    });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].payload.status).toBe("done");
    expect(db.updates[0].payload.completed_at).toBeTruthy();
  });

  it("addComment ignore un contenu vide", async () => {
    const { result } = await renderTasks();
    await act(async () => {
      await result.current.addComment(makeTask(), "   ");
    });
    expect(db.updates).toHaveLength(0);
  });

  it("addComment ajoute un commentaire", async () => {
    const { result } = await renderTasks();
    await act(async () => {
      await result.current.addComment(makeTask({ comments: [] }), "Bien vu");
    });
    expect(db.updates).toHaveLength(1);
    const comments = db.updates[0].payload.comments as { content: string }[];
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe("Bien vu");
  });

  it("shiftDates décale start ET due du même nombre de jours", async () => {
    const { result } = await renderTasks();
    const task = makeTask({ start_date: "2026-07-10", due_date: "2026-07-20" });
    await act(async () => {
      await result.current.shiftDates(task, 3);
    });
    expect(db.updates[0].payload).toMatchObject({
      start_date: "2026-07-13",
      due_date: "2026-07-23",
    });
  });

  it("removeTask retire la tâche du cache et appelle delete", async () => {
    db.tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
    const { result } = await renderTasks();
    await act(async () => {
      await result.current.removeTask(makeTask({ id: "t1" }));
    });
    expect(result.current.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(db.deletes).toContain("t1");
  });
});
