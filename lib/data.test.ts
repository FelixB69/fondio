import { describe, expect, it } from "vitest";
import { FORMAT_INSTRUCTIONS, ARTIFACTS_FORMAT_PROMPT } from "./data";

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
