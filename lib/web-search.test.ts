import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `searchWeb` lit TAVILY_API_KEY au chargement du module (const de niveau
// module). On la fixe AVANT l'import via vi.hoisted (hissé au-dessus des imports)
// pour que l'instance statique du module ait bien une clé.
vi.hoisted(() => {
  process.env.TAVILY_API_KEY = "test-tavily-key";
});

// On mocke la couche LLM : `gatherWebContext` s'appuie sur le tool-calling
// (callModelWithTools) et le fallback (callChatModel). On contrôle leurs retours
// pour tester la logique d'orchestration sans réseau ni modèle réel.
vi.mock("./llm", () => ({
  callChatModel: vi.fn(),
  callModelWithTools: vi.fn(),
}));

import { formatWebResultsForPrompt, gatherWebContext, searchWeb } from "./web-search";
import { callChatModel, callModelWithTools } from "./llm";
import type { ChatMessage } from "./data";

const callChatModelMock = vi.mocked(callChatModel);
const callModelWithToolsMock = vi.mocked(callModelWithTools);
const originalFetch = global.fetch;

function fetchOk(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

function msg(content: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return { role, content, ts: "2026-07-26T00:00:00.000Z" };
}

beforeEach(() => {
  global.fetch = vi.fn();
  callChatModelMock.mockReset();
  callModelWithToolsMock.mockReset();
  // Le module logue en dev (NODE_ENV !== production) : on garde la sortie propre.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("searchWeb", () => {
  it("poste vers Tavily avec Bearer, la requête et les valeurs par défaut", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fetchOk({ answer: "Résumé", results: [{ title: "T", url: "u", content: "c", score: 0.9 }] }),
    );

    const result = await searchWeb("prix hébergement");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-tavily-key");
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe("prix hébergement");
    expect(body.max_results).toBe(3);
    expect(body.search_depth).toBe("basic");
    expect(body.include_answer).toBe(true);
    expect(result).toEqual({
      query: "prix hébergement",
      answer: "Résumé",
      results: [{ title: "T", url: "u", content: "c", score: 0.9 }],
    });
  });

  it("respecte maxResults et depth quand ils sont fournis", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(fetchOk({ results: [] }));

    await searchWeb("q", { maxResults: 5, depth: "advanced" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.max_results).toBe(5);
    expect(body.search_depth).toBe("advanced");
  });

  it("comble les champs manquants (title/url/content/score) et answer null", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(fetchOk({ results: [{}] }));

    const result = await searchWeb("q");

    expect(result.answer).toBeNull();
    expect(result.results).toEqual([{ title: "", url: "", content: "", score: 0 }]);
  });

  it("remonte une erreur avec le status quand Tavily répond non-ok", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "quota dépassé",
    } as unknown as Response);

    await expect(searchWeb("q")).rejects.toThrow(/Tavily 429/);
  });

  it("échoue avec un message clair quand la clé Tavily est absente", async () => {
    // Instance fraîche du module, sans clé : chemin d'erreur explicite.
    vi.resetModules();
    const prev = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const mod = await import("./web-search");
    await expect(mod.searchWeb("q")).rejects.toThrow(/TAVILY_API_KEY manquante/);
    process.env.TAVILY_API_KEY = prev;
  });
});

describe("formatWebResultsForPrompt", () => {
  it("renvoie une chaîne vide quand il n'y a aucun résultat", () => {
    expect(formatWebResultsForPrompt({ query: "q", answer: null, results: [] })).toBe("");
  });

  it("numérote les sources [1], [2]… et inclut titre, url et contenu", () => {
    const block = formatWebResultsForPrompt({
      query: "q",
      answer: null,
      results: [
        { title: "Alpha", url: "https://a", content: "corps A", score: 0.9 },
        { title: "Beta", url: "https://b", content: "corps B", score: 0.8 },
      ],
    });
    expect(block).toContain("[1] Alpha — https://a");
    expect(block).toContain("corps A");
    expect(block).toContain("[2] Beta — https://b");
    // Rappelle de citer les sources entre crochets.
    expect(block).toMatch(/cite-la avec son numéro entre crochets/);
    // Rappelle la date du jour (année courante).
    expect(block).toContain(String(new Date().getFullYear()));
  });
});

describe("gatherWebContext", () => {
  it("utilise le tool-calling et dédoublonne les pages par URL", async () => {
    callModelWithToolsMock.mockResolvedValueOnce({
      data: {
        content: "",
        toolCalls: [
          { id: "1", name: "web_search", arguments: JSON.stringify({ query: "taille marché" }) },
        ],
      },
      providerLabel: "test",
    } as unknown as Awaited<ReturnType<typeof callModelWithTools>>);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fetchOk({
        results: [
          { title: "Alpha", url: "https://a", content: "ca", score: 0.9 },
          { title: "Beta", url: "https://b", content: "cb", score: 0.8 },
          { title: "Alpha bis", url: "https://a", content: "dup", score: 0.5 },
        ],
      }),
    );

    const result = await gatherWebContext([msg("Quelle est la taille du marché ?")]);

    // URL dédoublonnée : Alpha (a) et Beta (b), Alpha bis (a) éliminé.
    expect(result.sources).toEqual([
      { title: "Alpha", url: "https://a" },
      { title: "Beta", url: "https://b" },
    ]);
    expect(result.webContext).toContain("[1] Alpha — https://a");
    expect(result.webContext).toContain("[2] Beta — https://b");
    // Pas de fallback nécessaire : le décideur n'est pas appelé.
    expect(callChatModelMock).not.toHaveBeenCalled();
  });

  it("bascule sur le fallback quand le tool-calling ne ramène rien", async () => {
    // Étape 1 : le modèle ne déclenche aucun outil → aucune source.
    callModelWithToolsMock.mockResolvedValueOnce({
      data: { content: "FINI", toolCalls: [] },
      providerLabel: "test",
    } as unknown as Awaited<ReturnType<typeof callModelWithTools>>);
    // Étape 2 : le décideur formule une requête.
    callChatModelMock.mockResolvedValueOnce({
      data: JSON.stringify({ needSearch: true, query: "prix concurrents" }),
    } as unknown as Awaited<ReturnType<typeof callChatModel>>);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fetchOk({ results: [{ title: "Src", url: "https://s", content: "cs", score: 0.7 }] }),
    );

    const result = await gatherWebContext([msg("Combien coûtent les concurrents ?")]);

    expect(result.sources).toEqual([{ title: "Src", url: "https://s" }]);
    expect(result.webContext).toContain("[1] Src — https://s");
  });

  it("renvoie un contexte vide quand aucune recherche n'est utile", async () => {
    callModelWithToolsMock.mockResolvedValueOnce({
      data: { content: "FINI", toolCalls: [] },
      providerLabel: "test",
    } as unknown as Awaited<ReturnType<typeof callModelWithTools>>);
    callChatModelMock.mockResolvedValueOnce({
      data: JSON.stringify({ needSearch: false, query: "" }),
    } as unknown as Awaited<ReturnType<typeof callChatModel>>);

    const result = await gatherWebContext([msg("Merci beaucoup !")]);

    expect(result).toEqual({ webContext: "", sources: [] });
  });

  it("ne casse jamais le chat : une panne de recherche renvoie un contexte vide", async () => {
    // Le tool-calling plante, et le décideur ne veut pas chercher : on absorbe.
    callModelWithToolsMock.mockRejectedValueOnce(new Error("modèle sans support des outils"));
    callChatModelMock.mockResolvedValueOnce({
      data: JSON.stringify({ needSearch: false, query: "" }),
    } as unknown as Awaited<ReturnType<typeof callChatModel>>);

    const result = await gatherWebContext([msg("Bonjour")]);

    expect(result).toEqual({ webContext: "", sources: [] });
  });
});
