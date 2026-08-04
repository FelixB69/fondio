// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/data";
import { ArtifactBlock } from "./Artifact";

const prototype: Artifact = {
  kind: "prototype",
  title: "Maquette du tunnel de réservation",
  html: '<!DOCTYPE html><html><head><title>Réserver</title></head><body><button id="go">Réserver</button></body></html>',
};

function renderPrototype() {
  return render(<ArtifactBlock artifact={prototype} color="#0891B2" bg="#ECFEFF" />);
}

describe("ArtifactBlock — maquette", () => {
  it("isole la maquette dans une iframe sans allow-same-origin", () => {
    renderPrototype();
    const frame = screen.getByTitle("Maquette du tunnel de réservation");
    // Le seul garde-fou qui compte : `allow-same-origin` à côté de
    // `allow-scripts` rendrait la session Supabase lisible par le HTML généré.
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("injecte la CSP dans le document servi à l'iframe", () => {
    renderPrototype();
    const srcDoc = screen.getByTitle("Maquette du tunnel de réservation").getAttribute("srcdoc");
    expect(srcDoc).toContain("Content-Security-Policy");
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).toContain("<button id=\"go\">");
  });

  it("prévient que les données ne sont pas enregistrées, quoi qu'ait écrit le modèle", () => {
    renderPrototype();
    expect(screen.getByText(/données affichées sont fictives/i)).toBeInTheDocument();
  });

  it("montre le code en lecture seule, sans champ éditable", async () => {
    renderPrototype();
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByText(/<button id="go">/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("garde la même iframe en passant en plein écran (pas de rechargement)", async () => {
    renderPrototype();
    const before = screen.getByTitle("Maquette du tunnel de réservation");
    await userEvent.click(screen.getByRole("button", { name: /Agrandir/ }));
    expect(screen.getByTitle("Maquette du tunnel de réservation")).toBe(before);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ne propose pas de téléchargement bureautique pour une maquette", () => {
    renderPrototype();
    expect(screen.queryByRole("button", { name: /Télécharger/ })).toBeNull();
  });
});
