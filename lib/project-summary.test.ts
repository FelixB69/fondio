import { describe, expect, it } from "vitest";
import type { Task } from "./data";
import type { GlossaryEntry } from "./glossary";
import type { Project, ProjectSessionRow } from "./projects";
import { inDaysStr, addDaysYmd, todayStr } from "./tasks";
import { buildProjectSummaryPrompt, SUMMARY_MAX_LENGTH, SUMMARY_MIN_INTERVAL_MS } from "./project-summary";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    session_id: null,
    project_id: "p1",
    content: "Choisir l'hébergeur",
    status: "todo",
    priority: "normal",
    start_date: null,
    due_date: null,
    source_agent_id: null,
    created_at: daysAgo(3),
    completed_at: null,
    updated_at: daysAgo(3),
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
    stage: "dev",
    glossary: [],
    created_at: daysAgo(30),
    updated_at: daysAgo(1),
    ...over,
  };
}

function systemOf(input: {
  project?: Project;
  tasks?: Task[];
  sessions?: ProjectSessionRow[];
} = {}): string {
  const messages = buildProjectSummaryPrompt({
    project: input.project ?? makeProject(),
    tasks: input.tasks ?? [makeTask()],
    sessions: input.sessions ?? [makeSession()],
  });
  return messages[0].content;
}

describe("buildProjectSummaryPrompt — forme", () => {
  it("renvoie un tour système puis un tour utilisateur", () => {
    const messages = buildProjectSummaryPrompt({
      project: makeProject(),
      tasks: [makeTask()],
      sessions: [makeSession()],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    // Ollama attend un tour utilisateur : un prompt système seul ne répond pas.
    expect(messages[1].role).toBe("user");
  });
});

describe("buildProjectSummaryPrompt — sections interdites", () => {
  it("ne demande aucune des sections du format de chat", () => {
    const system = systemOf();
    expect(system).not.toContain("LIVRABLES:");
    expect(system).not.toContain("TÂCHES:");
    expect(system).not.toContain("LEXIQUE:");
    expect(system).not.toContain("CHALLENGES:");
  });

  it("interdit explicitement les titres et les listes", () => {
    expect(systemOf()).toMatch(/prose|aucune section|aucun titre/i);
  });
});

describe("buildProjectSummaryPrompt — ancrage dans les données", () => {
  it("décrit l'étape et l'avancement du projet", () => {
    const system = systemOf({
      project: makeProject({ stage: "recette" }),
      tasks: [
        makeTask({ id: "a", status: "done", completed_at: daysAgo(1) }),
        makeTask({ id: "b" }),
      ],
    });
    expect(system).toContain("Recette (4/6)");
    expect(system).toContain("1 tâche(s) faite(s) sur 2");
  });

  it("signale les retards constatés", () => {
    const system = systemOf({
      tasks: [makeTask({ id: "a", due_date: addDaysYmd(todayStr(), -2) })],
    });
    expect(system).toMatch(/retard/i);
  });

  it("rapporte l'activité récente", () => {
    const system = systemOf({
      sessions: [makeSession({ title: "Choix de la stack", updated_at: daysAgo(1) })],
    });
    expect(system).toContain("Choix de la stack");
  });

  it("interdit d'inventer", () => {
    expect(systemOf()).toMatch(/n'invente|invente pas|uniquement.*données/i);
  });
});

describe("buildProjectSummaryPrompt — vocabulaire", () => {
  const glossary: GlossaryEntry[] = [
    { term: "hébergement", definition: "…", session_id: "s1", ts: daysAgo(4) },
    { term: "nom de domaine", definition: "…", session_id: "s1", ts: daysAgo(4) },
  ];

  it("autorise les termes déjà expliqués et interdit le reste", () => {
    const system = systemOf({ project: makeProject({ glossary }) });
    expect(system).toContain("hébergement, nom de domaine");
    expect(system).toMatch(/aucun autre terme technique|tout autre (terme|jargon)/i);
  });

  it("interdit tout jargon quand le glossaire est vide", () => {
    const system = systemOf({ project: makeProject({ glossary: [] }) });
    expect(system).not.toContain("hébergement");
    expect(system).toMatch(/terme technique/i);
  });
});

describe("buildProjectSummaryPrompt — persona", () => {
  it("fait rédiger Clara en vouvoyant", () => {
    const system = systemOf();
    expect(system).toContain("Clara");
    expect(system).toMatch(/vouvoi/i);
  });
});

describe("constantes", () => {
  it("limite à une génération par minute", () => {
    expect(SUMMARY_MIN_INTERVAL_MS).toBe(60_000);
  });

  it("borne la taille du texte stocké", () => {
    expect(SUMMARY_MAX_LENGTH).toBeGreaterThan(0);
  });
});

describe("buildProjectSummaryPrompt — projet sans données", () => {
  it("reste constructible sur un projet vierge", () => {
    const system = systemOf({ tasks: [], sessions: [] });
    expect(system).toContain("Clara");
    expect(system).toContain("Aucune tâche enregistrée");
  });

  it("mentionne les échéances proches quand il y en a", () => {
    const system = systemOf({ tasks: [makeTask({ id: "a", due_date: inDaysStr(2) })] });
    expect(system).toMatch(/semaine|échéance/i);
  });
});
