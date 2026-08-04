import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./data";
import {
  PROTOTYPE_CSP,
  PROTOTYPE_SANDBOX,
  buildPrototypeSrcDoc,
  withLatestPrototype,
} from "./prototype";

describe("PROTOTYPE_SANDBOX", () => {
  // Garde-fou de sécurité : `allow-same-origin` conjugué à `allow-scripts`
  // rendrait la session Supabase de l'utilisateur lisible par le HTML généré.
  it("n'accorde jamais allow-same-origin", () => {
    expect(PROTOTYPE_SANDBOX).toBe("allow-scripts");
    expect(PROTOTYPE_SANDBOX).not.toContain("allow-same-origin");
  });
});

describe("PROTOTYPE_CSP", () => {
  it("coupe tout appel réseau sortant", () => {
    expect(PROTOTYPE_CSP).toContain("connect-src 'none'");
    expect(PROTOTYPE_CSP).toContain("default-src 'none'");
  });

  it("n'autorise que les origines de l'allowlist", () => {
    const hosts = PROTOTYPE_CSP.match(/https:\/\/[\w.-]+/g) ?? [];
    expect(new Set(hosts)).toEqual(
      new Set([
        "https://cdn.tailwindcss.com",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://placehold.co",
      ]),
    );
  });
});

describe("buildPrototypeSrcDoc", () => {
  it("injecte la CSP et le shim en tête de <head>", () => {
    const out = buildPrototypeSrcDoc(
      `<!DOCTYPE html><html><head><title>Démo</title></head><body>ok</body></html>`,
    );
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("localStorage");
    // La CSP doit précéder le contenu d'origine, sinon elle ne s'applique pas.
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
  });

  it("crée un <head> quand le modèle n'en produit pas", () => {
    const out = buildPrototypeSrcDoc(`<html><body><p>salut</p></body></html>`);
    expect(out).toContain("<head>");
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<p>"));
  });

  it("préfixe un fragment sans <html>", () => {
    const out = buildPrototypeSrcDoc(`<p>salut</p>`);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<p>"));
  });

  it("le shim précède les scripts de la maquette", () => {
    const out = buildPrototypeSrcDoc(
      `<html><head><script>localStorage.setItem("a","b")<\/script></head><body></body></html>`,
    );
    expect(out.indexOf("memoryStorage")).toBeLessThan(out.indexOf('localStorage.setItem("a","b")'));
  });

  it("ne casse pas sur une chaîne vide", () => {
    expect(buildPrototypeSrcDoc("   ")).toContain("Content-Security-Policy");
  });
});

describe("withLatestPrototype", () => {
  const msg = (
    role: "user" | "assistant",
    content: string,
    html?: string,
  ): ChatMessage => ({
    role,
    content,
    ts: "2026-08-04T10:00:00.000Z",
    ...(html ? { artifacts: [{ kind: "prototype" as const, title: "Maquette", html }] } : {}),
  });

  it("réinjecte le HTML de la dernière maquette", () => {
    const out = withLatestPrototype([
      msg("user", "fais une page"),
      msg("assistant", "voici", "<h1>v1</h1>"),
      msg("user", "mets le bouton en bleu"),
    ]);
    expect(out[1].content).toContain("<h1>v1</h1>");
    expect(out[1].content).toContain("RENVOIE ce fichier entier");
  });

  it("ne garde que la plus récente, les précédentes sont réduites à un marqueur", () => {
    const out = withLatestPrototype([
      msg("assistant", "v1", "<h1>v1</h1>"),
      msg("assistant", "v2", "<h1>v2</h1>"),
      msg("assistant", "v3", "<h1>v3</h1>"),
    ]);
    expect(out[0].content).not.toContain("<h1>v1</h1>");
    expect(out[1].content).not.toContain("<h1>v2</h1>");
    expect(out[0].content).toContain("remplacée");
    expect(out[2].content).toContain("<h1>v3</h1>");
  });

  it("laisse les messages sans maquette intacts", () => {
    const history = [msg("user", "bonjour"), msg("assistant", "bonjour à vous")];
    expect(withLatestPrototype(history)).toEqual([
      { role: "user", content: "bonjour" },
      { role: "assistant", content: "bonjour à vous" },
    ]);
  });

  it("ne fait rien sur un historique vide", () => {
    expect(withLatestPrototype([])).toEqual([]);
  });
});
