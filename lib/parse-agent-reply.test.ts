import { describe, expect, it } from "vitest";
import { parseAgentReply, stripTrailingSections } from "./parse-agent-reply";

describe("parseAgentReply", () => {
  it("renvoie le texte brut comme content quand aucune section n'est présente", () => {
    const raw = "Voici une réponse simple sur deux phrases. Sans structure.";
    const r = parseAgentReply(raw);
    expect(r.content).toBe(raw);
    expect(r.deliverables).toEqual([]);
    expect(r.challenges).toEqual([]);
  });

  it("extrait les sections LIVRABLES et CHALLENGES (cas idéal)", () => {
    const raw = [
      "Analyse de ton marché en deux temps.",
      "",
      "LIVRABLES:",
      "- Plan d'action 30 jours",
      "- Matrice de positionnement",
      "",
      "CHALLENGES:",
      "- As-tu validé la demande ?",
      "- Quel est ton angle mort budgétaire ?",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.content).toBe("Analyse de ton marché en deux temps.");
    expect(r.deliverables).toEqual(["Plan d'action 30 jours", "Matrice de positionnement"]);
    expect(r.challenges).toEqual(["As-tu validé la demande ?", "Quel est ton angle mort budgétaire ?"]);
  });

  it("tolère les décorations markdown autour des titres (Mistral cloud)", () => {
    const raw = [
      "Réponse principale.",
      "",
      "**LIVRABLES:**",
      "* Premier livrable",
      "* Deuxième livrable",
      "",
      "## CHALLENGES",
      "1. Première question",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.content).toBe("Réponse principale.");
    expect(r.deliverables).toEqual(["Premier livrable", "Deuxième livrable"]);
    expect(r.challenges).toEqual(["Première question"]);
  });

  it("s'arrête à la prose qui suit les puces (format violé par le modèle)", () => {
    const raw = [
      "Intro.",
      "",
      "LIVRABLES:",
      "- Vrai livrable",
      "Ceci est de la prose qui ne devrait pas devenir un livrable.",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.deliverables).toEqual(["Vrai livrable"]);
  });

  it("parse une réponse JSON spontanée avec champ message", () => {
    const raw = JSON.stringify({
      message: "Texte principal",
      deliverables: ["A", "B"],
      challenges: ["C"],
    });
    const r = parseAgentReply(raw);
    expect(r.content).toBe("Texte principal");
    expect(r.deliverables).toEqual(["A", "B"]);
    expect(r.challenges).toEqual(["C"]);
  });
});

describe("stripTrailingSections", () => {
  it("ne garde que la prose avant la première section", () => {
    const raw = "Prose visible.\n\nLIVRABLES:\n- x";
    expect(stripTrailingSections(raw)).toBe("Prose visible.");
  });

  it("renvoie le texte intact si aucune section", () => {
    const raw = "Juste du texte en streaming…";
    expect(stripTrailingSections(raw)).toBe(raw);
  });
});
