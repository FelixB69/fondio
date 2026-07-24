import { describe, expect, it } from "vitest";
import { pickEntryAgent } from "./route-agent";

describe("pickEntryAgent", () => {
  it("retombe sur Clara (pm) par défaut", () => {
    expect(pickEntryAgent("")).toBe("pm");
    expect(pickEntryAgent("   ")).toBe("pm");
    expect(pickEntryAgent("Je veux créer une appli pour vendre mes gâteaux")).toBe("pm");
    expect(pickEntryAgent("Un site vitrine pour mon activité, je ne sais pas coder")).toBe("pm");
  });

  it("route une question de compréhension vers Sam (teacher)", () => {
    expect(pickEntryAgent("C'est quoi une API ?")).toBe("teacher");
    expect(pickEntryAgent("Vous pouvez m'expliquer comment marche un hébergement ?")).toBe("teacher");
    expect(pickEntryAgent("Quelle est la différence entre front et back ?")).toBe("teacher");
  });

  it("route un souci technique vers Rui (quality)", () => {
    expect(pickEntryAgent("Mon site plante quand je clique sur valider")).toBe("quality");
    expect(pickEntryAgent("J'ai un bug, ça ne fonctionne pas")).toBe("quality");
    expect(pickEntryAgent("Comment tester mon projet avant de le montrer ?")).toBe("quality");
  });

  it("route la mise en ligne vers Nadia (devops)", () => {
    expect(pickEntryAgent("Comment mettre mon site en ligne ?")).toBe("devops");
    expect(pickEntryAgent("Où héberger mon projet et acheter un nom de domaine ?")).toBe("devops");
  });

  it("route un choix de techno vers Malik (architect)", () => {
    expect(pickEntryAgent("Quelle techno choisir pour mon appli mobile ?")).toBe("architect");
    expect(pickEntryAgent("J'hésite sur la stack et la base de données")).toBe("architect");
  });

  it("route un cadrage de périmètre vers Jade (product)", () => {
    expect(pickEntryAgent("Quelles fonctionnalités garder pour une première version ?")).toBe("product");
    expect(pickEntryAgent("Aidez-moi à décrire le parcours utilisateur")).toBe("product");
  });

  it("ne confond pas « en ligne » (usage) avec la mise en ligne (déploiement)", () => {
    // L'exemple du placeholder : une appli de réservation « en ligne » relève du
    // cadrage (Clara), pas du déploiement (Nadia).
    expect(
      pickEntryAgent("Je veux une appli pour réserver des cours de yoga en ligne, avec paiement"),
    ).toBe("pm");
    expect(pickEntryAgent("Un site pour vendre mes créations en ligne")).toBe("pm");
  });

  it("ignore accents et casse", () => {
    expect(pickEntryAgent("COMMENT DÉPLOYER mon site ?")).toBe("devops");
    expect(pickEntryAgent("c'est quoi le déploiement")).toBe("teacher");
  });

  it("privilégie l'intention la plus spécifique en cas de signaux mêlés", () => {
    // « c'est quoi » (teacher) prime sur « mettre en ligne » (devops) : la
    // question de compréhension doit être levée d'abord.
    expect(pickEntryAgent("C'est quoi mettre en ligne un site ?")).toBe("teacher");
  });
});
