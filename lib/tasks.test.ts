import { describe, expect, it } from "vitest";
import { Task } from "./data";
import {
  addDaysYmd,
  agendaBucket,
  compareTasks,
  diffDaysYmd,
  dueDateMeta,
  filterCounts,
  inDaysStr,
  matchesAgenda,
  matchesFilter,
  startOfWeekYmd,
  taskBounds,
  todayStr,
} from "./tasks";

// Fabrique une tâche minimale ; on surcharge les champs utiles au test.
// Les dates sont construites avec les helpers de la lib pour rester relatives
// à « aujourd'hui » (tests déterministes quel que soit le jour d'exécution).
function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: Math.random().toString(36).slice(2),
    session_id: null,
    project_id: null,
    content: "Tâche",
    status: "todo",
    priority: "normal",
    start_date: null,
    due_date: null,
    source_agent_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    ...over,
  };
}

describe("helpers de date", () => {
  it("addDaysYmd décale correctement, y compris en négatif et changement de mois", () => {
    expect(addDaysYmd("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diffDaysYmd renvoie le nombre de jours signé", () => {
    expect(diffDaysYmd("2026-01-01", "2026-01-04")).toBe(3);
    expect(diffDaysYmd("2026-01-04", "2026-01-01")).toBe(-3);
  });

  it("startOfWeekYmd renvoie toujours un lundi", () => {
    // 2026-06-24 est un mercredi → lundi = 2026-06-22.
    expect(startOfWeekYmd("2026-06-24")).toBe("2026-06-22");
    // Un lundi reste lui-même.
    expect(startOfWeekYmd("2026-06-22")).toBe("2026-06-22");
  });
});

describe("taskBounds", () => {
  it("renvoie null sans aucune date", () => {
    expect(taskBounds(makeTask())).toBeNull();
  });

  it("réordonne start/end si due est avant start", () => {
    const t = makeTask({ start_date: "2026-02-10", due_date: "2026-02-05" });
    expect(taskBounds(t)).toEqual({ start: "2026-02-05", end: "2026-02-10" });
  });

  it("journée unique si une seule date", () => {
    expect(taskBounds(makeTask({ due_date: "2026-02-05" }))).toEqual({ start: "2026-02-05", end: "2026-02-05" });
  });
});

describe("compareTasks", () => {
  it("place les tâches datées avant les non datées", () => {
    const dated = makeTask({ due_date: inDaysStr(3) });
    const undated = makeTask();
    expect(compareTasks(dated, undated)).toBeLessThan(0);
    expect(compareTasks(undated, dated)).toBeGreaterThan(0);
  });

  it("trie par échéance la plus proche d'abord", () => {
    const soon = makeTask({ due_date: inDaysStr(1) });
    const later = makeTask({ due_date: inDaysStr(10) });
    expect(compareTasks(soon, later)).toBeLessThan(0);
  });

  it("départage par priorité à échéance égale", () => {
    const high = makeTask({ due_date: inDaysStr(2), priority: "high" });
    const low = makeTask({ due_date: inDaysStr(2), priority: "low" });
    expect(compareTasks(high, low)).toBeLessThan(0);
  });
});

describe("matchesFilter", () => {
  it("'all' matche tout", () => {
    expect(matchesFilter(makeTask(), "all")).toBe(true);
  });

  it("'high' ne matche que la priorité haute", () => {
    expect(matchesFilter(makeTask({ priority: "high" }), "high")).toBe(true);
    expect(matchesFilter(makeTask({ priority: "normal" }), "high")).toBe(false);
  });

  it("'overdue' = échéance passée et non terminée", () => {
    expect(matchesFilter(makeTask({ due_date: addDaysYmd(todayStr(), -1) }), "overdue")).toBe(true);
    expect(matchesFilter(makeTask({ due_date: addDaysYmd(todayStr(), -1), status: "done" }), "overdue")).toBe(false);
    expect(matchesFilter(makeTask({ due_date: inDaysStr(3) }), "overdue")).toBe(false);
  });

  it("'week' = échéance dans les 7 prochains jours", () => {
    expect(matchesFilter(makeTask({ due_date: inDaysStr(3) }), "week")).toBe(true);
    expect(matchesFilter(makeTask({ due_date: inDaysStr(30) }), "week")).toBe(false);
  });
});

describe("filterCounts", () => {
  it("compte chaque catégorie sur l'ensemble complet", () => {
    const tasks = [
      makeTask({ due_date: addDaysYmd(todayStr(), -2) }), // overdue
      makeTask({ due_date: inDaysStr(2), priority: "high" }), // week + high
      makeTask({ priority: "high" }), // high
      makeTask({ status: "done", due_date: addDaysYmd(todayStr(), -1) }), // ni overdue ni week (done)
    ];
    const c = filterCounts(tasks);
    expect(c.all).toBe(4);
    expect(c.overdue).toBe(1);
    expect(c.week).toBe(1);
    expect(c.high).toBe(2);
  });
});

describe("dueDateMeta", () => {
  it("libelle 'Aujourd'hui' et 'Demain'", () => {
    expect(dueDateMeta(todayStr(), false).label).toBe("Aujourd'hui");
    expect(dueDateMeta(inDaysStr(1), false).label).toBe("Demain");
  });

  it("marque le retard en rouge", () => {
    const meta = dueDateMeta(addDaysYmd(todayStr(), -3), false);
    expect(meta.label).toContain("Retard");
    expect(meta.color).toBe("#DC2626");
  });

  it("une tâche done n'est jamais en retard", () => {
    const meta = dueDateMeta(addDaysYmd(todayStr(), -3), true);
    expect(meta.label).not.toContain("Retard");
  });
});

describe("agendaBucket", () => {
  it("exclut les tâches terminées", () => {
    expect(agendaBucket(makeTask({ status: "done", due_date: todayStr() }))).toBeNull();
  });

  it("classe par horizon", () => {
    expect(agendaBucket(makeTask())).toBe("nodate");
    expect(agendaBucket(makeTask({ due_date: addDaysYmd(todayStr(), -1) }))).toBe("overdue");
    expect(agendaBucket(makeTask({ due_date: todayStr() }))).toBe("today");
    expect(agendaBucket(makeTask({ due_date: inDaysStr(3) }))).toBe("week");
    expect(agendaBucket(makeTask({ due_date: inDaysStr(30) }))).toBe("later");
  });
});

describe("matchesAgenda", () => {
  const base = { query: "", projectId: null, agentId: null, showDone: false };

  it("masque les tâches faites par défaut", () => {
    expect(matchesAgenda(makeTask({ status: "done" }), base)).toBe(false);
    expect(matchesAgenda(makeTask({ status: "done" }), { ...base, showDone: true })).toBe(true);
  });

  it("filtre par projet et par recherche texte", () => {
    const t = makeTask({ project_id: "p1", content: "Rédiger le pitch" });
    expect(matchesAgenda(t, { ...base, projectId: "p1" })).toBe(true);
    expect(matchesAgenda(t, { ...base, projectId: "p2" })).toBe(false);
    expect(matchesAgenda(t, { ...base, query: "pitch" })).toBe(true);
    expect(matchesAgenda(t, { ...base, query: "budget" })).toBe(false);
  });
});
