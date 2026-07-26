import { beforeEach, describe, expect, it, vi } from "vitest";

// État de la « base » simulée, partagé avec la factory du mock via vi.hoisted
// (hissé au-dessus des imports). Le module met en cache son client Supabase :
// un mock lisant cet état mutable reste valide entre les tests.
const db = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  dismissals: [] as unknown[],
  upserts: [] as { row: unknown; opts: unknown }[],
}));

vi.mock("./supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => ({
      select: async () => ({ data: db.dismissals }),
      upsert: async (row: unknown, opts: unknown) => {
        db.upserts.push({ row, opts });
        return { error: null };
      },
    }),
  }),
}));

import { fetchDismissals, insertDismissal } from "./use-notifications";

beforeEach(() => {
  db.user = { id: "user-1" };
  db.dismissals = [];
  db.upserts = [];
});

describe("fetchDismissals", () => {
  it("renvoie les dismissals de la base", async () => {
    db.dismissals = [{ task_id: "t1", due_date: "2026-07-30" }];
    expect(await fetchDismissals()).toEqual([{ task_id: "t1", due_date: "2026-07-30" }]);
  });

  it("renvoie un tableau vide quand data est null", async () => {
    db.dismissals = null as unknown as unknown[];
    expect(await fetchDismissals()).toEqual([]);
  });
});

describe("insertDismissal", () => {
  it("ne fait rien quand aucun utilisateur n'est connecté", async () => {
    db.user = null;
    await insertDismissal("t1", "2026-07-30");
    expect(db.upserts).toHaveLength(0);
  });

  it("upsert la dismissal avec la contrainte de conflit user/task/date", async () => {
    await insertDismissal("t1", "2026-07-30");
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].row).toMatchObject({
      user_id: "user-1",
      task_id: "t1",
      due_date: "2026-07-30",
    });
    expect(db.upserts[0].opts).toEqual({ onConflict: "user_id,task_id,due_date" });
  });
});
