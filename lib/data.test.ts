import { describe, expect, it } from "vitest";
import {
  ARTIFACTS_FORMAT_PROMPT,
  FORMAT_INSTRUCTIONS,
  PANEL_AGENT_IDS,
  buildSystemPrompt,
} from "./data";

describe("FORMAT_INSTRUCTIONS", () => {
  it("exige l'ancrage des livrables sur un fait précis", () => {
    expect(FORMAT_INSTRUCTIONS).toContain("ANCRAGE OBLIGATOIRE");
    expect(FORMAT_INSTRUCTIONS).toContain("Plan de prospection pour les 12 cafés du 11e arrondissement");
  });

  it("liste les formulations interdites sans précision", () => {
    expect(FORMAT_INSTRUCTIONS).toContain("Formulations interdites");
  });
});

describe("ARTIFACTS_FORMAT_PROMPT", () => {
  it("exige l'ancrage du contenu détaillé sur des faits réels", () => {
    expect(ARTIFACTS_FORMAT_PROMPT).toContain("Règle d'ancrage");
  });

  it("interdit la fabrication de faits non donnés par l'utilisateur", () => {
    expect(ARTIFACTS_FORMAT_PROMPT).toContain("N'invente jamais");
    expect(ARTIFACTS_FORMAT_PROMPT).toContain("[à préciser]");
  });
});

describe("Maquettiste (agent prototyper)", () => {
  it("est exclu du mode Panel", () => {
    expect(PANEL_AGENT_IDS).not.toContain("prototyper");
    // Les six autres restent éligibles.
    expect(PANEL_AGENT_IDS).toHaveLength(6);
  });

  it("reçoit un brief adapté au genre du projet", () => {
    const web = buildSystemPrompt("prototyper", false, "web");
    const script = buildSystemPrompt("prototyper", false, "script");
    expect(web).toContain("MAQUETTISTE");
    // Un script n'a pas d'écran : on met sa SORTIE en scène.
    expect(script).toContain("faux terminal");
    expect(script).not.toContain("cadre de téléphone");
  });

  it("interdit le stockage et le réseau, impossibles dans le bac à sable", () => {
    const p = buildSystemPrompt("prototyper", false, "web");
    expect(p).toContain("localStorage");
    expect(p).toContain("INTERDIT");
    expect(p).toContain("```html");
  });

  it("exige de dire que les données sont fictives", () => {
    expect(buildSystemPrompt("prototyper", false, "web")).toContain("HONNÊTETÉ OBLIGATOIRE");
  });

  it("n'ouvre le droit à la maquette à aucun autre agent que le Formateur", () => {
    for (const id of ["architect", "pm", "product", "quality", "devops"] as const) {
      expect(buildSystemPrompt(id, false, "web")).not.toContain("```html");
    }
    // Le Formateur, lui, peut illustrer une explication par une démo courte.
    expect(buildSystemPrompt("teacher", false, "web")).toContain("```html");
  });
});
