// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentSelector } from "./AgentSelector";

// Le bouton bascule Panel n'a pas de libellé (interrupteur stylé) : on le repère
// comme l'unique bouton sans texte.
function panelToggle(): HTMLElement {
  const btn = screen.getAllByRole("button").find((b) => b.textContent === "");
  if (!btn) throw new Error("Toggle panel introuvable");
  return btn;
}

describe("AgentSelector — mode simple", () => {
  it("sélectionne un agent au clic et le remonte par son id", async () => {
    const onSelect = vi.fn();
    render(<AgentSelector type="web" onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Malik/ }));
    expect(onSelect).toHaveBeenCalledWith("architect");
  });

  it("Retour appelle onBack", async () => {
    const onBack = vi.fn();
    render(<AgentSelector type="web" onSelect={() => {}} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /Retour/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSelector — mode panel", () => {
  it("le toggle bascule l'en-tête en mode panel", async () => {
    render(<AgentSelector type="web" onSelect={() => {}} onBack={() => {}} />);
    await userEvent.click(panelToggle());
    expect(screen.getByText(/vos agents pour le panel/)).toBeInTheDocument();
  });

  it("en panel, cliquer un agent ne lance pas la session (sélection multiple)", async () => {
    const onSelect = vi.fn();
    render(<AgentSelector type="web" onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(panelToggle());
    await userEvent.click(screen.getByRole("button", { name: /Malik/ }));
    // Un seul agent : le panel n'est pas lançable, onSelect non appelé.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("lance le panel avec les agents sélectionnés (≥ 2)", async () => {
    const onSelect = vi.fn();
    render(<AgentSelector type="web" onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(panelToggle());
    await userEvent.click(screen.getByRole("button", { name: /Malik/ }));
    await userEvent.click(screen.getByRole("button", { name: /Clara/ }));
    await userEvent.click(screen.getByRole("button", { name: /Lancer le panel/ }));
    expect(onSelect).toHaveBeenCalledWith(["architect", "pm"]);
  });

  it("plafonne la sélection à 4 agents", async () => {
    const onSelect = vi.fn();
    render(<AgentSelector type="web" onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(panelToggle());
    for (const name of ["Malik", "Clara", "Jade", "Rui", "Nadia"]) {
      await userEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    }
    await userEvent.click(screen.getByRole("button", { name: /Lancer le panel/ }));
    // Le 5e (Nadia) est refusé : on ne garde que les 4 premiers.
    expect(onSelect).toHaveBeenCalledWith(["architect", "pm", "product", "quality"]);
  });
});
