// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "@/lib/data";
import { addDaysYmd, inDaysStr, todayStr, type TaskFilter } from "@/lib/tasks";
import { makeTask, makeUseTasks } from "@/test/helpers/use-tasks";

// Le composant appelle `useTasks` lui-même (cache SWR partagé en production) :
// on le simule pour garder des tests synchrones et sans réseau.
vi.mock("@/lib/use-tasks", () => ({ useTasks: vi.fn() }));

import { useTasks } from "@/lib/use-tasks";
import { ProjectTasksTab } from "./ProjectTasksTab";

const useTasksMock = vi.mocked(useTasks);

// Jeu de tâches couvrant les 3 statuts et les 3 filtres non triviaux :
// en retard (t2), cette semaine (t3), priorité haute (t5).
const TASKS: Task[] = [
  makeTask({ id: "t1", content: "Écrire le cahier des charges" }),
  makeTask({ id: "t2", content: "Relancer le prestataire", due_date: addDaysYmd(todayStr(), -1) }),
  makeTask({ id: "t3", content: "Choisir l'hébergeur", status: "doing", due_date: inDaysStr(3) }),
  makeTask({ id: "t4", content: "Acheter le nom de domaine", status: "done" }),
  makeTask({
    id: "t5",
    content: "Valider le budget",
    priority: "high",
    source_agent_id: "pm",
    session_id: "s1",
  }),
];

interface Props {
  projectId: string;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  onOpenSession: (sessionId: string) => void;
}

function renderTab(over: Partial<Props> = {}): Props {
  const props: Props = {
    projectId: "p1",
    filter: "all",
    onFilterChange: vi.fn(),
    onOpenSession: vi.fn(),
    ...over,
  };
  render(<ProjectTasksTab {...props} />);
  return props;
}

// Une colonne Kanban : <colonne> > <en-tête> > <libellé de statut>. Les libellés
// de statut apparaissent aussi sur les boutons d'avancement des cartes
// (« Passer à : En cours ») — d'où le filtre sur les ancêtres <button>.
function column(label: string): HTMLElement {
  const header = screen.getAllByText(label).find((el) => !el.closest("button"))!;
  return header.parentElement!.parentElement!;
}

beforeEach(() => {
  useTasksMock.mockReset();
  useTasksMock.mockReturnValue(makeUseTasks(TASKS));
});

describe("ProjectTasksTab — vue Kanban", () => {
  it("répartit les tâches dans les trois colonnes avec leurs compteurs", () => {
    renderTab();

    const todo = column("À faire");
    expect(within(todo).getByText("3")).toBeInTheDocument();
    expect(within(todo).getByText("Écrire le cahier des charges")).toBeInTheDocument();
    expect(within(todo).getByText("Valider le budget")).toBeInTheDocument();

    const doing = column("En cours");
    expect(within(doing).getByText("1")).toBeInTheDocument();
    expect(within(doing).getByText("Choisir l'hébergeur")).toBeInTheDocument();

    const done = column("Fait");
    expect(within(done).getByText("Acheter le nom de domaine")).toBeInTheDocument();
  });

  it("affiche « Vide. » dans les colonnes sans tâche", () => {
    useTasksMock.mockReturnValue(makeUseTasks([makeTask({ id: "t1", content: "Seule" })]));
    renderTab();
    // « En cours » et « Fait » sont vides.
    expect(screen.getAllByText("Vide.")).toHaveLength(2);
  });
});

describe("ProjectTasksTab — filtres", () => {
  it("ne rend que les tâches correspondant au filtre actif", () => {
    renderTab({ filter: "overdue" });
    expect(screen.getByText("Relancer le prestataire")).toBeInTheDocument();
    expect(screen.queryByText("Écrire le cahier des charges")).not.toBeInTheDocument();
  });

  it("remonte le filtre choisi au parent", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderTab();
    await user.click(screen.getByRole("button", { name: /En retard/ }));
    expect(onFilterChange).toHaveBeenCalledWith("overdue");
  });

  it("calcule les compteurs de chips sur l'ensemble, pas sur le sous-ensemble filtré", () => {
    renderTab({ filter: "overdue" });
    // 5 tâches au total, dont 1 en retard : les compteurs ne bougent pas avec le filtre.
    expect(screen.getByRole("button", { name: /Toutes\s*5/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /En retard\s*1/ })).toBeInTheDocument();
  });
});

describe("ProjectTasksTab — création rapide", () => {
  it("crée la tâche puis vide le champ", async () => {
    const user = userEvent.setup();
    const created = makeTask({ id: "new", content: "Réserver le nom de domaine" });
    const hook = makeUseTasks(TASKS, { addTask: vi.fn(async () => created) });
    useTasksMock.mockReturnValue(hook);
    renderTab();

    const input = screen.getByPlaceholderText(/Nouvelle action pour ce projet/);
    await user.type(input, "Réserver le nom de domaine");
    await user.click(screen.getByRole("button", { name: /Ajouter/ }));

    expect(hook.addTask).toHaveBeenCalledWith({ content: "Réserver le nom de domaine" });
    expect(input).toHaveValue("");
  });

  it("désactive le bouton tant que le champ est vide", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /Ajouter/ })).toBeDisabled();
  });
});

describe("ProjectTasksTab — mutations", () => {
  const solo = makeTask({ id: "t1", content: "Relire le devis" });

  it("fait avancer le statut au clic sur la pastille (vue Liste)", async () => {
    const user = userEvent.setup();
    const hook = makeUseTasks([solo]);
    useTasksMock.mockReturnValue(hook);
    renderTab();

    await user.click(screen.getByRole("button", { name: /Liste/ }));
    await user.click(screen.getByTitle("Passer à : En cours"));
    expect(hook.cycleStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("applique le statut choisi dans le select (vue Liste)", async () => {
    const user = userEvent.setup();
    const hook = makeUseTasks([solo]);
    useTasksMock.mockReturnValue(hook);
    renderTab();

    await user.click(screen.getByRole("button", { name: /Liste/ }));
    // 1er select = priorité (TaskControls), 2e = statut.
    const [, statusSelect] = screen.getAllByRole("combobox");
    await user.selectOptions(statusSelect, "done");
    expect(hook.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "done");
  });

  it("supprime la tâche", async () => {
    const user = userEvent.setup();
    const hook = makeUseTasks([solo]);
    useTasksMock.mockReturnValue(hook);
    renderTab();

    await user.click(screen.getByTitle("Supprimer"));
    expect(hook.removeTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("enregistre l'intitulé modifié en ligne", async () => {
    const user = userEvent.setup();
    const hook = makeUseTasks([solo]);
    useTasksMock.mockReturnValue(hook);
    renderTab();

    await user.click(screen.getByText("Relire le devis"));
    // Le champ de création rapide est lui aussi un textbox : on vise le textarea.
    const textarea = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    await user.clear(textarea);
    await user.type(textarea, "Relire le devis signé{Enter}");

    expect(hook.setContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1" }),
      "Relire le devis signé",
    );
  });
});

describe("ProjectTasksTab — liens et état vide", () => {
  it("ouvre la session source d'une tâche produite par un agent", async () => {
    const user = userEvent.setup();
    useTasksMock.mockReturnValue(
      makeUseTasks([makeTask({ id: "t5", content: "Valider le budget", source_agent_id: "pm", session_id: "s1" })]),
    );
    const { onOpenSession } = renderTab();

    await user.click(screen.getByTitle("Ouvrir la session source"));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
  });

  it("invite à créer une tâche quand le projet n'en a aucune", () => {
    useTasksMock.mockReturnValue(makeUseTasks([]));
    renderTab();
    expect(screen.getByText(/Pas encore de tâche pour ce projet/)).toBeInTheDocument();
  });
});
