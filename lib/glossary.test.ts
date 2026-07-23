import { describe, expect, it } from "vitest";
import { buildKnownTermsInstruction, knownTerms, mergeGlossary } from "./glossary";

const META = { session_id: "s1", ts: "2026-01-01T00:00:00Z" };

describe("mergeGlossary", () => {
  it("ajoute les nouveaux termes à un glossaire vide", () => {
    const out = mergeGlossary([], [{ term: "API", definition: "une porte logicielle" }], META);
    expect(out).toEqual([
      { term: "API", definition: "une porte logicielle", session_id: "s1", ts: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("ignore un terme déjà présent (insensible à la casse) sans écraser sa définition", () => {
    const existing = [{ term: "API", definition: "définition d'origine", session_id: "s0", ts: "t0" }];
    const out = mergeGlossary(existing, [{ term: "api", definition: "autre définition" }], META);
    expect(out).toHaveLength(1);
    expect(out[0].definition).toBe("définition d'origine");
  });

  it("déduplique aussi à l'intérieur d'un même lot", () => {
    const out = mergeGlossary(
      [],
      [
        { term: "API", definition: "une porte" },
        { term: "api", definition: "doublon" },
        { term: "SEO", definition: "être trouvé sur Google" },
      ],
      META,
    );
    expect(out.map((e) => e.term)).toEqual(["API", "SEO"]);
  });
});

describe("knownTerms", () => {
  it("liste les termes du glossaire", () => {
    expect(
      knownTerms([
        { term: "API", definition: "x", session_id: null, ts: "t" },
        { term: "SEO", definition: "y", session_id: null, ts: "t" },
      ]),
    ).toEqual(["API", "SEO"]);
  });
});

describe("buildKnownTermsInstruction", () => {
  it("renvoie une chaîne vide pour un glossaire vide", () => {
    expect(buildKnownTermsInstruction([])).toBe("");
  });

  it("liste les termes déjà expliqués quand il y en a", () => {
    const s = buildKnownTermsInstruction([
      { term: "API", definition: "x", session_id: null, ts: "t" },
      { term: "hébergement", definition: "y", session_id: null, ts: "t" },
    ]);
    expect(s).toContain("API");
    expect(s).toContain("hébergement");
    // Doit dire de NE PAS re-définir.
    expect(s.toLowerCase()).toMatch(/re.?d[ée]fini|déjà expliqué/);
  });
});
