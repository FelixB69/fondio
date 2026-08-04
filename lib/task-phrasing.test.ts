import { describe, expect, it } from "vitest";
import { toActionTitle } from "./task-phrasing";

describe("toActionTitle", () => {
  it("laisse intacte une tâche déjà formulée en action", () => {
    expect(toActionTitle("Appeler l'hébergeur pour comparer les offres")).toBe(
      "Appeler l'hébergeur pour comparer les offres",
    );
    expect(toActionTitle("Mettre en place la sauvegarde quotidienne")).toBe(
      "Mettre en place la sauvegarde quotidienne",
    );
  });

  it("nettoie puce, gras markdown et point final", () => {
    expect(toActionTitle("- **Rédiger le brief.**")).toBe("Rédiger le brief");
  });

  it("retire les tournures qui noient le verbe", () => {
    expect(toActionTitle("Il faut appeler le prestataire")).toBe("Appeler le prestataire");
    expect(toActionTitle("Vous devez valider la maquette")).toBe("Valider la maquette");
    expect(toActionTitle("Penser à relancer l'agence")).toBe("Relancer l'agence");
    expect(toActionTitle("À faire : tester le formulaire")).toBe("Tester le formulaire");
  });

  it("transforme un livrable (nom de chose) en action", () => {
    expect(toActionTitle("Plan de prospection pour les 12 cafés du 11e")).toBe(
      "Établir le plan de prospection pour les 12 cafés du 11e",
    );
    expect(toActionTitle("Cahier des charges de la page panier")).toBe(
      "Rédiger le cahier des charges de la page panier",
    );
    expect(toActionTitle("Maquette du tunnel de réservation")).toBe(
      "Créer la maquette du tunnel de réservation",
    );
    expect(toActionTitle("Comparatif des hébergeurs")).toBe("Réaliser le comparatif des hébergeurs");
  });

  it("élide l'article devant une voyelle", () => {
    expect(toActionTitle("Appel d'offres pour le développement")).toBe(
      "Lancer l'appel d'offres pour le développement",
    );
    expect(toActionTitle("Estimation du budget mensuel")).toBe("Établir l'estimation du budget mensuel");
  });

  it("accorde l'article au pluriel", () => {
    expect(toActionTitle("Tests de la page panier")).toBe("Réaliser les tests de la page panier");
  });

  it("préserve les acronymes", () => {
    expect(toActionTitle("API de paiement Stripe")).toBe("Créer l'API de paiement Stripe");
  });

  it("n'ajoute pas d'article quand l'intitulé porte déjà le sien", () => {
    expect(toActionTitle("La maquette du panier")).toBe("Créer la maquette du panier");
    expect(toActionTitle("Une réunion de cadrage avec Paul")).toBe(
      "Organiser une réunion de cadrage avec Paul",
    );
  });

  it("préfixe un verbe passe-partout quand le déterminant est déjà là", () => {
    expect(toActionTitle("Le partenariat avec la mairie du 11e")).toBe(
      "Préparer le partenariat avec la mairie du 11e",
    );
  });

  it("laisse le nom intact quand on ne sait pas quel verbe ni quel genre employer", () => {
    expect(toActionTitle("Partenariat avec la mairie du 11e")).toBe("Partenariat avec la mairie du 11e");
  });

  it("renvoie une chaîne vide pour une entrée vide", () => {
    expect(toActionTitle("   ")).toBe("");
  });
});
