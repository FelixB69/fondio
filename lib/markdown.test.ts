import { describe, expect, it } from "vitest";
import { escapeHtmlAttr, markdownToSafeHtml, sanitizeHtml } from "./markdown";

describe("markdownToSafeHtml", () => {
  it("rend le markdown normal (gras, listes)", () => {
    const html = markdownToSafeHtml("# Titre\n\n- **fort**");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>fort</strong>");
  });

  it("retire les balises <script> injectées", () => {
    const html = markdownToSafeHtml("Bonjour<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("retire les gestionnaires d'événements (onerror sur <img>)", () => {
    const html = markdownToSafeHtml('<img src="x" onerror="alert(document.cookie)">');
    expect(html).not.toContain("onerror");
  });

  it("neutralise les liens en protocole javascript:", () => {
    const html = markdownToSafeHtml("[clic](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("conserve target=_blank sur un lien légitime", () => {
    const html = sanitizeHtml('<a href="https://ex.com" target="_blank">x</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="https://ex.com"');
  });
});

describe("escapeHtmlAttr", () => {
  it("échappe guillemets, chevrons et esperluette", () => {
    expect(escapeHtmlAttr('a"b<c>d&e')).toBe("a&quot;b&lt;c&gt;d&amp;e");
  });

  it("empêche la sortie d'attribut (pas de guillemet brut)", () => {
    // Une URL malveillante qui tenterait d'ajouter un onmouseover ne peut plus
    // « fermer » l'attribut href.
    const escaped = escapeHtmlAttr('https://x" onmouseover="alert(1)');
    expect(escaped).not.toContain('"');
    expect(escaped).toContain("&quot;");
  });
});
