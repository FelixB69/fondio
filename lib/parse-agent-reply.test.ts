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

  it("extrait la section TÂCHES en plus de LIVRABLES et CHALLENGES", () => {
    const raw = [
      "Cadrage du projet.",
      "",
      "LIVRABLES:",
      "- Cahier des charges v1",
      "",
      "TÂCHES:",
      "- Rédiger la page d'accueil",
      "- Choisir l'hébergeur",
      "",
      "CHALLENGES:",
      "- Le budget couvre-t-il la maintenance ?",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.content).toBe("Cadrage du projet.");
    expect(r.deliverables).toEqual(["Cahier des charges v1"]);
    expect(r.tasks).toEqual(["Rédiger la page d'accueil", "Choisir l'hébergeur"]);
    expect(r.challenges).toEqual(["Le budget couvre-t-il la maintenance ?"]);
  });

  it("tolère TÂCHES sans accent et coupe la prose au bon endroit", () => {
    const raw = [
      "Plan de la semaine.",
      "",
      "TACHES:",
      "- Installer l'environnement",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.content).toBe("Plan de la semaine.");
    expect(r.tasks).toEqual(["Installer l'environnement"]);
    expect(r.deliverables).toEqual([]);
  });

  it("extrait la section LEXIQUE en paires terme/définition", () => {
    const raw = [
      "Pour votre site, il faut choisir un hébergement.",
      "",
      "LEXIQUE:",
      "- API — une porte qui laisse deux logiciels se parler",
      "- hébergement : l'endroit où vit votre site sur internet",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.content).toBe("Pour votre site, il faut choisir un hébergement.");
    expect(r.lexicon).toEqual([
      { term: "API", definition: "une porte qui laisse deux logiciels se parler" },
      { term: "hébergement", definition: "l'endroit où vit votre site sur internet" },
    ]);
  });

  it("ignore une entrée LEXIQUE sans définition", () => {
    const raw = ["Texte.", "", "LEXIQUE:", "- API", "- CI/CD — livrer en continu"].join("\n");
    const r = parseAgentReply(raw);
    expect(r.lexicon).toEqual([{ term: "CI/CD", definition: "livrer en continu" }]);
  });

  it("coexiste avec LIVRABLES, TÂCHES et CHALLENGES", () => {
    const raw = [
      "Intro.",
      "LIVRABLES:",
      "- Cahier des charges",
      "TÂCHES:",
      "- Choisir l'hébergeur",
      "LEXIQUE:",
      "- hébergeur — l'entreprise qui héberge votre site",
      "CHALLENGES:",
      "- Quel budget ?",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.deliverables).toEqual(["Cahier des charges"]);
    expect(r.tasks).toEqual(["Choisir l'hébergeur"]);
    expect(r.lexicon).toEqual([{ term: "hébergeur", definition: "l'entreprise qui héberge votre site" }]);
    expect(r.challenges).toEqual(["Quel budget ?"]);
  });

  it("retire un bloc de section placé EN TÊTE et garde la prose qui suit", () => {
    const raw = [
      "LEXIQUE:",
      "- Site — une vitrine en ligne",
      "",
      "Un site est une vitrine numérique.",
      "Vous pouvez y mettre vos photos.",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.lexicon).toEqual([{ term: "Site", definition: "une vitrine en ligne" }]);
    expect(r.content).toBe("Un site est une vitrine numérique.\nVous pouvez y mettre vos photos.");
    expect(r.content).not.toContain("LEXIQUE");
  });

  it("nettoie les décorations markdown dans les entrées de lexique", () => {
    const raw = ["Intro.", "", "LEXIQUE:", "- **Site (site web)** — une vitrine sur `Internet`"].join("\n");
    const r = parseAgentReply(raw);
    expect(r.lexicon).toEqual([{ term: "Site (site web)", definition: "une vitrine sur Internet" }]);
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

  it("extrait ORIENTER (prénom) et le retire de la prose", () => {
    const raw = [
      "Sur le planning je peux vous aider, mais pour la stack je passe la main.",
      "",
      "ORIENTER: Malik — choix de la stack technique",
    ].join("\n");
    const r = parseAgentReply(raw);
    expect(r.orient).toEqual({ agentId: "architect", reason: "choix de la stack technique" });
    expect(r.content).not.toContain("ORIENTER");
    expect(r.content).toContain("je passe la main.");
  });

  it("résout ORIENTER par le rôle et tolère la ponctuation", () => {
    const raw = "Réponse.\n\nORIENTER: Chef de projet — cadrer le périmètre";
    const r = parseAgentReply(raw);
    expect(r.orient?.agentId).toBe("pm");
  });

  it("orient=null quand le prénom n'est pas reconnu", () => {
    const raw = "Réponse.\n\nORIENTER: Roberto — inconnu au bataillon";
    const r = parseAgentReply(raw);
    expect(r.orient).toBeNull();
  });

  it("orient=null quand aucune section ORIENTER", () => {
    const r = parseAgentReply("Juste une réponse normale.");
    expect(r.orient).toBeNull();
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

  it("garde la prose même si une section est placée en tête (streaming)", () => {
    const raw = "LEXIQUE:\n- API — une porte\n\nUn site est une vitrine.";
    expect(stripTrailingSections(raw)).toBe("Un site est une vitrine.");
  });
});
