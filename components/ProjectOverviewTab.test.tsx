// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Project, ProjectSessionRow } from "@/lib/projects";
import { ProjectOverviewTab } from "./ProjectOverviewTab";

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
}

function renderTab(over: Partial<Props> = {}): Props {
  const props: Props = {
    project: makeProject(),
    sessions: [makeSession()],
    onOpenSession: vi.fn(),
    ...over,
  };
  render(<ProjectOverviewTab {...props} />);
  return props;
}

describe("ProjectOverviewTab — sessions", () => {
  it("liste les sessions avec leur titre et leur agent", () => {
    renderTab();
    expect(screen.getByText("Sessions (1)")).toBeInTheDocument();
    expect(screen.getByText("Cadrage du projet")).toBeInTheDocument();
    expect(screen.getByText(/Chef de projet/)).toBeInTheDocument();
  });

  it("nomme une session de panel par son nombre d'agents", () => {
    renderTab({
      sessions: [makeSession({ panel_agent_ids: ["pm", "architect", "devops"] })],
    });
    expect(screen.getByText(/Panel · 3 agents/)).toBeInTheDocument();
  });

  it("retombe sur « Nouvelle session » quand le titre est absent", () => {
    renderTab({ sessions: [makeSession({ title: null })] });
    expect(screen.getByText("Nouvelle session")).toBeInTheDocument();
  });

  it("ouvre la session au clic", async () => {
    const user = userEvent.setup();
    const { onOpenSession } = renderTab();
    await user.click(screen.getByText("Cadrage du projet"));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
  });

  it("masque le bloc quand le projet n'a aucune session", () => {
    renderTab({ sessions: [] });
    expect(screen.queryByText(/^Sessions \(/)).not.toBeInTheDocument();
  });
});

describe("ProjectOverviewTab — glossaire", () => {
  const glossary = [
    { term: "API", definition: "Une porte d'entrée pour faire dialoguer deux logiciels.", session_id: "s1", ts: "2026-07-02T00:00:00.000Z" },
    { term: "Hébergement", definition: "L'endroit où votre site tourne en permanence.", session_id: "s1", ts: "2026-07-03T00:00:00.000Z" },
  ];

  it("affiche les termes déjà expliqués avec leur définition", () => {
    renderTab({ project: makeProject({ glossary }) });
    expect(screen.getByText("Glossaire (2)")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText(/porte d'entrée pour faire dialoguer/)).toBeInTheDocument();
  });

  it("masque le bloc quand le glossaire est vide", () => {
    renderTab({ project: makeProject({ glossary: [] }) });
    expect(screen.queryByText(/^Glossaire \(/)).not.toBeInTheDocument();
  });
});
