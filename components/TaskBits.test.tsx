// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditableContent, FilterChips, TaskControls } from "./TaskBits";
import type { Task } from "@/lib/data";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    session_id: null,
    project_id: null,
    content: "Original",
    status: "todo",
    priority: "normal",
    start_date: null,
    due_date: null,
    source_agent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-07-01T00:00:00.000Z",
    comments: [],
    ...over,
  };
}

describe("FilterChips", () => {
  const filters = [
    { id: "all", label: "Tout" },
    { id: "todo", label: "À faire" },
    { id: "done", label: "Fait" },
  ] as const;

  it("masque les chips vides sauf la première (all)", () => {
    render(
      <FilterChips
        filters={[...filters]}
        active="all"
        counts={{ all: 0, todo: 2, done: 0 }}
        onChange={() => {}}
      />,
    );
    // « Tout » (première) reste visible même à 0 ; « Fait » (0) est masqué.
    expect(screen.getByRole("button", { name: /Tout/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /À faire/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fait/ })).not.toBeInTheDocument();
  });

  it("affiche le compteur de chaque chip", () => {
    render(
      <FilterChips
        filters={[...filters]}
        active="all"
        counts={{ all: 5, todo: 2, done: 3 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Tout\s*5/ })).toBeInTheDocument();
  });

  it("notifie le filtre choisi au clic", async () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        filters={[...filters]}
        active="all"
        counts={{ all: 5, todo: 2, done: 3 }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Fait/ }));
    expect(onChange).toHaveBeenCalledWith("done");
  });
});

describe("EditableContent", () => {
  it("passe en édition au clic et pré-remplit le contenu courant", async () => {
    render(<EditableContent task={makeTask()} done={false} fontSize={14} onSave={() => {}} />);
    await userEvent.click(screen.getByText("Original"));
    expect(screen.getByRole("textbox")).toHaveValue("Original");
  });

  it("enregistre sur Entrée quand le texte a changé", async () => {
    const onSave = vi.fn();
    render(<EditableContent task={makeTask()} done={false} fontSize={14} onSave={onSave} />);
    await userEvent.click(screen.getByText("Original"));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "Nouveau contenu{Enter}");
    expect(onSave).toHaveBeenCalledWith("Nouveau contenu");
    // Retour en mode affichage.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("n'enregistre pas si le texte est inchangé", async () => {
    const onSave = vi.fn();
    render(<EditableContent task={makeTask()} done={false} fontSize={14} onSave={onSave} />);
    await userEvent.click(screen.getByText("Original"));
    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("n'enregistre pas un contenu vide", async () => {
    const onSave = vi.fn();
    render(<EditableContent task={makeTask()} done={false} fontSize={14} onSave={onSave} />);
    await userEvent.click(screen.getByText("Original"));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("annule sur Échap sans enregistrer", async () => {
    const onSave = vi.fn();
    render(<EditableContent task={makeTask()} done={false} fontSize={14} onSave={onSave} />);
    await userEvent.click(screen.getByText("Original"));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "Abandonné{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });
});

describe("TaskControls", () => {
  it("remonte le changement de priorité", async () => {
    const onSetPriority = vi.fn();
    render(
      <TaskControls
        task={makeTask({ priority: "normal" })}
        onSetPriority={onSetPriority}
        onSetStart={() => {}}
        onSetDue={() => {}}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "high");
    expect(onSetPriority).toHaveBeenCalledWith("high");
  });

  it("renvoie null quand on vide une date", () => {
    const onSetStart = vi.fn();
    render(
      <TaskControls
        task={makeTask({ start_date: "2026-07-10" })}
        onSetPriority={() => {}}
        onSetStart={onSetStart}
        onSetDue={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Début"), { target: { value: "" } });
    expect(onSetStart).toHaveBeenCalledWith(null);
  });

  it("remonte une nouvelle échéance", () => {
    const onSetDue = vi.fn();
    render(
      <TaskControls
        task={makeTask()}
        onSetPriority={() => {}}
        onSetStart={() => {}}
        onSetDue={onSetDue}
      />,
    );
    fireEvent.change(screen.getByLabelText("Échéance"), { target: { value: "2026-08-01" } });
    expect(onSetDue).toHaveBeenCalledWith("2026-08-01");
  });
});
