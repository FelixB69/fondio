// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "@/lib/data";
import type { DashboardAction } from "@/lib/project-dashboard";
import type { Project, ProjectSessionRow, StageId } from "@/lib/projects";
import { addDaysYmd, inDaysStr, todayStr } from "@/lib/tasks";
import { makeTask, makeUseTasks } from "@/test/helpers/use-tasks";

vi.mock("@/lib/use-tasks", () => ({ useTasks: vi.fn() }));

import { useTasks } from "@/lib/use-tasks";
import { ProjectOverviewTab } from "./ProjectOverviewTab";

const useTasksMock = vi.mocked(useTasks);

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Site vitrine",
    icon: "target",
    color: "#264573",
    project_type: "web",
    stage: "cadrage",
    glossary: [],
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function makeSession(over: Partial<ProjectSessionRow> = {}): ProjectSessionRow {
  return {
    id: "s1",
    agent_id: "pm",
    title: "Cadrage du projet",
    challenger_mode: false,
    messages: [],
    updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    panel_agent_ids: null,
    ...over,
  };
}

interface Props {
  project: Project;
  sessions: ProjectSessionRow[];
  onOpenSession: (sessionId: string) => void;
  onAction: (action: DashboardAction) => void;
  onStageChange: (stage: StageId) => void;
}

function renderTab(over: Partial<Props> = {}): Props {
  const props: Props = {
    project: makeProject(),
    sessions: [makeSession()],
    onOpenSession: vi.fn(),
    onAction: vi.fn(),
    onStageChange: vi.fn(),
    ...over,
  };
  render(<ProjectOverviewTab {...props} />);
  return props;
}

function tile(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(label) });
}

// Un bloc de la vue d'ensemble, par son titre. Nécessaire parce qu'un même
// intitulé de tâche ou de session apparaît légitimement dans son bloc ET dans
// « Activité récente ».
function section(title: string): HTMLElement {
  return screen.getByText(title).parentElement!;
}

// Projet sain : des tâches datées, rien en retard, rien qui traîne.
const HEALTHY: Task[] = [
  makeTask({ id: "a", status: "done", completed_at: new Date().toISOString(), due_date: inDaysStr(2) }),
  makeTask({ id: "b", content: "Choisir l'hébergeur", due_date: inDaysStr(3) }),
  makeTask({ id: "c", content: "Rédiger les textes", due_date: inDaysStr(10) }),
];

beforeEach(() => {
  useTasksMock.mockReset();
  useTasksMock.mockReturnValue(makeUseTasks(HEALTHY));
});

describe("ProjectOverviewTab — indicateurs", () => {
  it("affiche l'avancement et le détail des tâches", () => {
    renderTab();
    expect(within(tile("Avancement")).getByText("33 %")).toBeInTheDocument();
    expect(within(tile("Avancement")).getByText("1 / 3 tâches")).toBeInTheDocument();
  });

  it("affiche « — » plutôt que 0 % quand rien n'est planifié", () => {
    useTasksMock.mockReturnValue(makeUseTasks([]));
    renderTab();
    expect(within(tile("Avancement")).getByText("—")).toBeInTheDocument();
  });

  it("renvoie vers le board filtré au clic sur « En retard »", async () => {
    const user = userEvent.setup();
    useTasksMock.mockReturnValue(
      makeUseTasks([makeTask({ id: "a", due_date: addDaysYmd(todayStr(), -1) })]),
    );
    const { onAction } = renderTab();
    await user.click(tile("En retard"));
    expect(onAction).toHaveBeenCalledWith({ kind: "tasks", filter: "overdue" });
  });

  it("renvoie vers le board filtré au clic sur « Cette semaine »", async () => {
    const user = userEvent.setup();
    const { onAction } = renderTab();
    await user.click(tile("Cette semaine"));
    expect(onAction).toHaveBeenCalledWith({ kind: "tasks", filter: "week" });
  });
});

describe("ProjectOverviewTab — étape en cours", () => {
  it("explique l'étape et propose la suivante", async () => {
    const user = userEvent.setup();
    const { onStageChange } = renderTab({ project: makeProject({ stage: "dev" }) });

    expect(screen.getByText("Développement")).toBeInTheDocument();
    expect(screen.getByText("3 / 6")).toBeInTheDocument();
    expect(screen.getByText(/découper le travail en petits morceaux/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Passer à : Recette/ }));
    expect(onStageChange).toHaveBeenCalledWith("recette");
  });

  it("ne propose pas d'étape suivante en maintenance", () => {
    renderTab({ project: makeProject({ stage: "maintenance" }) });
    expect(screen.queryByRole("button", { name: /Passer à/ })).not.toBeInTheDocument();
  });
});

describe("ProjectOverviewTab — points de vigilance", () => {
  it("affiche l'alerte de retard et déclenche son action", async () => {
    const user = userEvent.setup();
    useTasksMock.mockReturnValue(
      makeUseTasks([makeTask({ id: "a", due_date: addDaysYmd(todayStr(), -1) })]),
    );
    const { onAction } = renderTab();

    expect(screen.getByText(/a dépassé sa date/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voir les retards" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "tasks", filter: "overdue" });
  });

  it("ne rend aucun bloc de vigilance sur un projet sain", () => {
    renderTab();
    expect(screen.queryByText("Points de vigilance")).not.toBeInTheDocument();
  });
});

describe("ProjectOverviewTab — prochaines échéances", () => {
  it("liste les échéances à venir", () => {
    renderTab();
    const bloc = within(section("Prochaines échéances"));
    expect(bloc.getByText("Choisir l'hébergeur")).toBeInTheDocument();
    expect(bloc.getByText("Rédiger les textes")).toBeInTheDocument();
  });

  it("ouvre le détail de la tâche au clic, sans quitter le cockpit", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(within(section("Prochaines échéances")).getByText("Choisir l'hébergeur"));
    expect(screen.getByRole("heading", { name: "Modifier la tâche" })).toBeInTheDocument();
  });

  it("invite à planifier quand aucune tâche n'a de date", () => {
    useTasksMock.mockReturnValue(makeUseTasks([makeTask({ id: "a" })]));
    renderTab();
    expect(screen.getByText(/Aucune échéance planifiée/)).toBeInTheDocument();
  });
});

describe("ProjectOverviewTab — activité récente", () => {
  it("mêle sessions et mouvements de tâches", () => {
    renderTab();
    expect(screen.getByText(/Échange avec Clara/)).toBeInTheDocument();
    expect(screen.getAllByText("Tâche ajoutée").length).toBeGreaterThan(0);
  });
});

describe("ProjectOverviewTab — projet vierge", () => {
  it("remplace les indicateurs par une carte d'amorçage", async () => {
    const user = userEvent.setup();
    useTasksMock.mockReturnValue(makeUseTasks([]));
    const { onAction } = renderTab({ sessions: [] });

    expect(screen.queryByRole("button", { name: /Avancement/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Votre projet est créé/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Démarrer avec Clara/ }));
    expect(onAction).toHaveBeenCalledWith({ kind: "newSession", agentId: "pm" });
  });

  it("garde la carte d'étape visible", () => {
    useTasksMock.mockReturnValue(makeUseTasks([]));
    renderTab({ sessions: [] });
    expect(screen.getByText("Cadrage")).toBeInTheDocument();
  });
});

describe("ProjectOverviewTab — sessions", () => {
  it("liste les sessions avec leur titre et leur agent", () => {
    renderTab();
    const bloc = within(section("Sessions (1)"));
    expect(bloc.getByText("Cadrage du projet")).toBeInTheDocument();
    expect(bloc.getByText(/Chef de projet/)).toBeInTheDocument();
  });

  it("nomme une session de panel par son nombre d'agents", () => {
    renderTab({ sessions: [makeSession({ panel_agent_ids: ["pm", "architect", "devops"] })] });
    expect(screen.getAllByText(/Panel · 3 agents/).length).toBeGreaterThan(0);
  });

  it("retombe sur « Nouvelle session » quand le titre est absent", () => {
    renderTab({ sessions: [makeSession({ title: null })] });
    expect(screen.getAllByText("Nouvelle session").length).toBeGreaterThan(0);
  });

  it("ouvre la session au clic", async () => {
    const user = userEvent.setup();
    const { onOpenSession } = renderTab();
    await user.click(within(section("Sessions (1)")).getByText("Cadrage du projet"));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
  });

  it("masque le bloc quand le projet n'a aucune session", () => {
    renderTab({ sessions: [] });
    expect(screen.queryByText(/^Sessions \(/)).not.toBeInTheDocument();
  });
});

describe("ProjectOverviewTab — glossaire", () => {
  const entry = (term: string, definition: string) => ({
    term,
    definition,
    session_id: "s1",
    ts: "2026-07-02T00:00:00.000Z",
  });

  it("affiche les termes déjà expliqués avec leur définition", () => {
    renderTab({
      project: makeProject({
        glossary: [entry("API", "Une porte d'entrée pour faire dialoguer deux logiciels.")],
      }),
    });
    expect(screen.getByText("Glossaire (1)")).toBeInTheDocument();
    expect(screen.getByText(/porte d'entrée pour faire dialoguer/)).toBeInTheDocument();
  });

  it("n'affiche que les 6 termes les plus récents, dépliables", async () => {
    const user = userEvent.setup();
    const glossary = Array.from({ length: 9 }, (_, i) => entry(`Terme ${i}`, `Définition ${i}`));
    renderTab({ project: makeProject({ glossary }) });

    // Les 6 DERNIERS ajoutés, donc Terme 3 à Terme 8.
    expect(screen.queryByText("Terme 0")).not.toBeInTheDocument();
    expect(screen.getByText("Terme 8")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Afficher les 9 termes/ }));
    expect(screen.getByText("Terme 0")).toBeInTheDocument();
  });

  it("masque le bloc quand le glossaire est vide", () => {
    renderTab({ project: makeProject({ glossary: [] }) });
    expect(screen.queryByText(/^Glossaire \(/)).not.toBeInTheDocument();
  });
});
