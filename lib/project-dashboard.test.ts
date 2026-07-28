import { describe, expect, it } from "vitest";
import type { ChatMessage, Task } from "./data";
import { addDaysYmd, filterCounts, inDaysStr, todayStr } from "./tasks";
import type { Project, ProjectSessionRow } from "./projects";
import { buildDashboard, IDLE_DAYS, MAX_ACTIVITY, MAX_ALERTS, MAX_UPCOMING } from "./project-dashboard";

// Horodatage relatif à maintenant : les tests ne figent jamais l'horloge (même
// convention que lib/tasks.test.ts, qui compose ses dates avec inDaysStr).
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function makeTask(over: Partial<Task> = {}): Task {
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
    created_at: daysAgo(1),
    completed_at: null,
    updated_at: daysAgo(1),
    comments: [],
    ...over,
  };
}

function makeSession(over: Partial<ProjectSessionRow> = {}): ProjectSessionRow {
  return {
    id: "s1",
    agent_id: "pm",
    title: "Cadrage",
    challenger_mode: false,
    messages: [],
    updated_at: daysAgo(1),
    panel_agent_ids: null,
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Site vitrine",
    icon: "target",
    color: "#264573",
    project_type: "web",
    stage: "cadrage",
    glossary: [],
    created_at: daysAgo(30),
    updated_at: daysAgo(1),
    ...over,
  };
}

function build(
  tasks: Task[],
  sessions: ProjectSessionRow[] = [makeSession()],
  project: Project = makeProject(),
) {
  return buildDashboard({ project, tasks, sessions });
}

// Un projet « sain » : des tâches datées, aucune en retard, de l'activité récente.
const HEALTHY: Task[] = [
  makeTask({ id: "a", status: "done", completed_at: daysAgo(1), due_date: inDaysStr(2) }),
  makeTask({ id: "b", due_date: inDaysStr(3) }),
  makeTask({ id: "c", due_date: inDaysStr(10) }),
];

describe("buildDashboard — indicateurs", () => {
  it("laisse l'avancement à null quand le projet n'a aucune tâche", () => {
    // 0 % serait faux : rien n'a été planifié, ce n'est pas « rien de fait ».
    expect(build([]).kpis.progress).toBeNull();
  });

  it("calcule l'avancement en pourcentage de tâches faites", () => {
    const { kpis } = build([
      makeTask({ id: "a", status: "done", completed_at: daysAgo(1) }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" }),
      makeTask({ id: "d" }),
    ]);
    expect(kpis).toMatchObject({ progress: 25, done: 1, total: 4 });
  });

  it("aligne « en retard » et « cette semaine » sur les chips du board", () => {
    const tasks = [
      makeTask({ id: "a", due_date: addDaysYmd(todayStr(), -2) }),
      makeTask({ id: "b", due_date: inDaysStr(3) }),
      makeTask({ id: "c", due_date: inDaysStr(30) }),
    ];
    const counts = filterCounts(tasks);
    const { kpis } = build(tasks);
    expect(kpis.overdue).toBe(counts.overdue);
    expect(kpis.week).toBe(counts.week);
  });

  it("compte les livrables produits par les agents", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "…", deliverables: ["Cahier des charges", "Budget"], ts: daysAgo(2) },
      { role: "user", content: "merci", ts: daysAgo(2) },
    ];
    expect(build(HEALTHY, [makeSession({ messages })]).kpis.deliverables).toBe(2);
  });
});

describe("buildDashboard — points de vigilance", () => {
  it("signale les tâches en retard et renvoie vers le filtre correspondant", () => {
    const { alerts } = build([makeTask({ id: "a", due_date: addDaysYmd(todayStr(), -1) })]);
    const overdue = alerts.find((a) => a.id === "overdue")!;
    expect(overdue.level).toBe("warn");
    expect(overdue.message).toContain("1");
    expect(overdue.action).toEqual({ kind: "tasks", filter: "overdue" });
  });

  it("signale l'absence totale de dates", () => {
    const { alerts } = build([makeTask({ id: "a" }), makeTask({ id: "b" })]);
    expect(alerts.map((a) => a.id)).toContain("nodates");
  });

  it("ne signale pas l'absence de dates dès qu'une tâche en a une", () => {
    const { alerts } = build([makeTask({ id: "a" }), makeTask({ id: "b", due_date: inDaysStr(4) })]);
    expect(alerts.map((a) => a.id)).not.toContain("nodates");
  });

  it("propose un plan d'action quand le projet n'a aucune tâche", () => {
    const { alerts } = build([]);
    const noplan = alerts.find((a) => a.id === "noplan")!;
    expect(noplan.action).toEqual({ kind: "newSession", agentId: "pm" });
  });

  it("signale un projet en pause au-delà du seuil d'inactivité", () => {
    const stale = [makeTask({ id: "a", due_date: inDaysStr(5), created_at: daysAgo(40), updated_at: daysAgo(40) })];
    const { alerts } = build(stale, [makeSession({ updated_at: daysAgo(40) })]);
    const idle = alerts.find((a) => a.id === "idle")!;
    expect(idle.level).toBe("warn");
    expect(idle.message).toContain("40");
  });

  it("ne signale pas de pause juste en deçà du seuil", () => {
    const recent = [makeTask({ id: "a", due_date: inDaysStr(5), created_at: daysAgo(IDLE_DAYS - 1), updated_at: daysAgo(IDLE_DAYS - 1) })];
    const { alerts } = build(recent, [makeSession({ updated_at: daysAgo(IDLE_DAYS - 1) })]);
    expect(alerts.map((a) => a.id)).not.toContain("idle");
  });

  it("invite à changer d'étape quand tout est fait", () => {
    const done = [makeTask({ id: "a", status: "done", completed_at: daysAgo(1), due_date: inDaysStr(1) })];
    const { alerts } = build(done, [makeSession()], makeProject({ stage: "recette" }));
    const allDone = alerts.find((a) => a.id === "allDone")!;
    expect(allDone.action).toEqual({ kind: "nextStage", stage: "prod" });
  });

  it("n'invite pas à changer d'étape en maintenance", () => {
    const done = [makeTask({ id: "a", status: "done", completed_at: daysAgo(1), due_date: inDaysStr(1) })];
    const { alerts } = build(done, [makeSession()], makeProject({ stage: "maintenance" }));
    expect(alerts.map((a) => a.id)).not.toContain("allDone");
  });

  it("signale un développement où rien n'est terminé", () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `t${i}`, due_date: inDaysStr(i + 1) }),
    );
    const { alerts } = build(tasks, [makeSession()], makeProject({ stage: "dev" }));
    expect(alerts.map((a) => a.id)).toContain("stalled");
  });

  it("ne signale pas de blocage en dessous du seuil de tâches", () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ id: `t${i}`, due_date: inDaysStr(i + 1) }),
    );
    const { alerts } = build(tasks, [makeSession()], makeProject({ stage: "dev" }));
    expect(alerts.map((a) => a.id)).not.toContain("stalled");
  });

  it("n'affiche aucune alerte sur un projet sain", () => {
    expect(build(HEALTHY).alerts).toEqual([]);
  });

  it("plafonne les alertes et respecte l'ordre de priorité", () => {
    // Projet cumulant retard (1), pause (4) et développement bloqué (6).
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask({
        id: `t${i}`,
        due_date: addDaysYmd(todayStr(), -(i + 1)),
        created_at: daysAgo(40),
        updated_at: daysAgo(40),
      }),
    );
    const { alerts } = build(tasks, [makeSession({ updated_at: daysAgo(40) })], makeProject({ stage: "dev" }));
    expect(alerts).toHaveLength(MAX_ALERTS);
    expect(alerts[0].id).toBe("overdue");
    expect(alerts.map((a) => a.id)).toEqual(["overdue", "idle", "stalled"]);
  });
});

describe("buildDashboard — prochaines échéances", () => {
  it("écarte les tâches faites et les tâches sans date", () => {
    const { upcoming } = build([
      makeTask({ id: "done", status: "done", completed_at: daysAgo(1), due_date: inDaysStr(1) }),
      makeTask({ id: "nodate" }),
      makeTask({ id: "keep", due_date: inDaysStr(2) }),
    ]);
    expect(upcoming.map((t) => t.id)).toEqual(["keep"]);
  });

  it("place les retards en tête et limite la liste", () => {
    const tasks = [
      makeTask({ id: "far", due_date: inDaysStr(9) }),
      makeTask({ id: "late", due_date: addDaysYmd(todayStr(), -3) }),
      makeTask({ id: "soon", due_date: inDaysStr(1) }),
      makeTask({ id: "d", due_date: inDaysStr(2) }),
      makeTask({ id: "e", due_date: inDaysStr(3) }),
      makeTask({ id: "f", due_date: inDaysStr(4) }),
    ];
    const { upcoming } = build(tasks);
    expect(upcoming).toHaveLength(MAX_UPCOMING);
    expect(upcoming[0].id).toBe("late");
    expect(upcoming[1].id).toBe("soon");
  });
});

describe("buildDashboard — activité récente", () => {
  it("fusionne sessions, créations et clôtures, du plus récent au plus ancien", () => {
    const tasks = [
      makeTask({ id: "a", content: "Choisir l'hébergeur", created_at: daysAgo(5), updated_at: daysAgo(2), status: "done", completed_at: daysAgo(2) }),
    ];
    const { activity } = build(tasks, [makeSession({ updated_at: daysAgo(1), title: "Cadrage" })]);
    expect(activity.map((a) => a.kind)).toEqual(["session", "taskDone", "taskCreated"]);
    expect(activity[0].detail).toBe("Cadrage");
    expect(activity[1].detail).toBe("Choisir l'hébergeur");
  });

  it("nomme l'agent d'une session et rend la ligne cliquable", () => {
    const { activity } = build([], [makeSession({ id: "s9", agent_id: "pm" })]);
    expect(activity[0].label).toContain("Clara");
    expect(activity[0].sessionId).toBe("s9");
  });

  it("nomme une session de panel par son nombre d'agents", () => {
    const { activity } = build([], [makeSession({ panel_agent_ids: ["pm", "architect", "devops"] })]);
    expect(activity[0].label).toContain("Panel · 3 agents");
  });

  it("ne laisse pas de sessionId sur les événements de tâche", () => {
    const { activity } = build([makeTask({ id: "a" })], []);
    expect(activity[0].sessionId).toBeUndefined();
  });

  it("plafonne le flux", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask({ id: `t${i}`, created_at: daysAgo(i + 1) }));
    expect(build(tasks, []).activity).toHaveLength(MAX_ACTIVITY);
  });
});

describe("buildDashboard — projet vierge", () => {
  it("est vierge sans tâche ni session", () => {
    expect(build([], []).isBlank).toBe(true);
  });

  it("n'est pas vierge dès qu'une session existe", () => {
    expect(build([], [makeSession()]).isBlank).toBe(false);
  });

  it("n'est pas vierge dès qu'une tâche existe", () => {
    expect(build([makeTask()], []).isBlank).toBe(false);
  });
});

describe("buildDashboard — obsolescence de la synthèse", () => {
  it("reste à jour tant qu'aucune synthèse n'existe", () => {
    expect(build(HEALTHY).summaryStale).toBe(false);
  });

  it("est obsolète quand une tâche a bougé après la génération", () => {
    const project = makeProject({
      summary: { text: "…", provider: "local", providerLabel: "Mistral (local)", generated_at: daysAgo(3) },
    });
    const tasks = [makeTask({ id: "a", updated_at: daysAgo(1), created_at: daysAgo(10) })];
    expect(buildDashboard({ project, tasks, sessions: [] }).summaryStale).toBe(true);
  });

  it("reste à jour quand rien n'a bougé depuis la génération", () => {
    const project = makeProject({
      summary: { text: "…", provider: "local", providerLabel: "Mistral (local)", generated_at: daysAgo(1) },
    });
    const tasks = [makeTask({ id: "a", updated_at: daysAgo(5), created_at: daysAgo(10) })];
    expect(buildDashboard({ project, tasks, sessions: [] }).summaryStale).toBe(false);
  });
});
