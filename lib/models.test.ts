import { describe, expect, it } from "vitest";
import { prettyModelName, providerPrivacyNote } from "./models";

describe("prettyModelName — nouvelles familles BYOK", () => {
  it("reconnaît Claude", () => {
    expect(prettyModelName("claude-sonnet-4-6")).toBe("Claude Sonnet");
  });
  it("reconnaît GPT", () => {
    expect(prettyModelName("gpt-4o-mini")).toBe("GPT-4o mini");
  });
  it("reconnaît Gemini", () => {
    expect(prettyModelName("gemini-2.0-flash")).toBe("Gemini Flash");
  });
});

describe("providerPrivacyNote('byok')", () => {
  it("mentionne que c'est la clé de l'utilisateur, facturée par le fournisseur", () => {
    const note = providerPrivacyNote("byok");
    expect(note).toMatch(/votre clé/i);
  });
});
