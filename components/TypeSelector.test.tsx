// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeSelector } from "./TypeSelector";

describe("TypeSelector", () => {
  it("propose les six genres de projet", () => {
    render(<TypeSelector onSelect={() => {}} />);
    for (const name of [
      "Site / app web",
      "Projet IA / agent IA",
      "Script / automatisation",
      "Application mobile",
      "API / backend / intégration",
      "Autre projet tech",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("remonte le genre choisi au clic", async () => {
    const onSelect = vi.fn();
    render(<TypeSelector onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Site \/ app web/ }));
    expect(onSelect).toHaveBeenCalledWith("web");
  });

  it("n'affiche Retour que si onBack est fourni", async () => {
    const onBack = vi.fn();
    const { rerender } = render(<TypeSelector onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /Retour/ })).not.toBeInTheDocument();
    rerender(<TypeSelector onSelect={() => {}} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /Retour/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
