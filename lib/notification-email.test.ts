import { describe, expect, it } from "vitest";
import { buildEmailBody, buildEmailSubject, sortByUrgency, EmailNotificationTask } from "./notification-email";

const overdue: EmailNotificationTask = { content: "Relancer le client X", due_date: "2026-06-24", urgency: "overdue" };
const today: EmailNotificationTask = { content: "Préparer le pitch deck", due_date: "2026-06-26", urgency: "today" };
const tomorrow: EmailNotificationTask = { content: "Envoyer la facture", due_date: "2026-06-27", urgency: "tomorrow" };

describe("sortByUrgency", () => {
  it("trie overdue > today > tomorrow", () => {
    expect(sortByUrgency([tomorrow, overdue, today])).toEqual([overdue, today, tomorrow]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const input = [tomorrow, overdue];
    sortByUrgency(input);
    expect(input).toEqual([tomorrow, overdue]);
  });
});

describe("buildEmailSubject", () => {
  it("inclut le nombre de tâches", () => {
    expect(buildEmailSubject([overdue, today])).toBe("Fondio — 2 tâche(s) à traiter");
  });
});

describe("buildEmailBody", () => {
  it("liste les tâches triées par urgence avec date JJ/MM et lien agenda", () => {
    const body = buildEmailBody([tomorrow, overdue, today], "https://fondio.app/agenda");
    expect(body).toBe(
      "Vous avez 3 tâche(s) qui réclament votre attention :\n\n" +
        "⚠️ En retard : Relancer le client X (échéance 24/06)\n" +
        "📅 Aujourd'hui : Préparer le pitch deck (échéance 26/06)\n" +
        "📅 Demain : Envoyer la facture (échéance 27/06)\n\n" +
        "→ Voir dans l'agenda : https://fondio.app/agenda"
    );
  });
});
