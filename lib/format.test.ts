import { describe, expect, it } from "vitest";
import { formatRelative } from "./format";

// Construit une date ISO située `ms` millisecondes dans le passé.
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  it("gère les paliers minute / heure / jour", () => {
    expect(formatRelative(ago(10_000))).toBe("À l'instant");
    expect(formatRelative(ago(5 * MIN))).toBe("Il y a 5 min");
    expect(formatRelative(ago(3 * HOUR))).toBe("Il y a 3h");
    expect(formatRelative(ago(4 * DAY))).toBe("Il y a 4j");
  });

  it("au-delà d'une semaine : format semaines par défaut", () => {
    expect(formatRelative(ago(21 * DAY))).toBe("Il y a 3 sem.");
  });

  it("au-delà d'une semaine : date absolue si absoluteAfterWeek", () => {
    const out = formatRelative(ago(21 * DAY), { absoluteAfterWeek: true });
    // Format JJ/MM/AAAA (fr-FR) — on vérifie la forme, pas la valeur exacte.
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
