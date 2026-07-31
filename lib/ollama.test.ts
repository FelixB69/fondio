import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OLLAMA_AUTH_ERROR,
  isLocalOllama,
  ollamaBaseUrl,
  ollamaFetch,
  ollamaHeaders,
} from "./ollama";

// Les variables d'env sont lues à chaque appel : on peut donc les changer entre
// deux tests, à condition de restaurer l'état initial.
const ENV_KEYS = ["OLLAMA_BASE_URL", "OLLAMA_URL", "OLLAMA_USER", "OLLAMA_PASSWORD"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("ollamaBaseUrl", () => {
  it("retombe sur localhost sans configuration", () => {
    expect(ollamaBaseUrl()).toBe("http://localhost:11434");
  });

  it("accepte OLLAMA_URL comme alias de OLLAMA_BASE_URL", () => {
    process.env.OLLAMA_URL = "https://ai.exemple.fr";
    expect(ollamaBaseUrl()).toBe("https://ai.exemple.fr");
  });

  it("donne la priorité à OLLAMA_BASE_URL", () => {
    process.env.OLLAMA_BASE_URL = "https://a.exemple.fr";
    process.env.OLLAMA_URL = "https://b.exemple.fr";
    expect(ollamaBaseUrl()).toBe("https://a.exemple.fr");
  });

  it("retire le slash final (évite les doubles slashs dans les chemins)", () => {
    process.env.OLLAMA_BASE_URL = "https://ai.exemple.fr/";
    expect(ollamaBaseUrl()).toBe("https://ai.exemple.fr");
  });
});

describe("isLocalOllama", () => {
  it("reconnaît localhost et 127.0.0.1", () => {
    expect(isLocalOllama("http://localhost:11434")).toBe(true);
    expect(isLocalOllama("http://127.0.0.1:11434")).toBe(true);
  });

  it("considère un domaine public comme distant", () => {
    expect(isLocalOllama("https://ai.exemple.fr")).toBe(false);
  });
});

describe("ollamaHeaders", () => {
  it("n'ajoute rien sans identifiants", () => {
    expect(ollamaHeaders({ "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("n'ajoute rien si un seul des deux identifiants est fourni", () => {
    process.env.OLLAMA_USER = "fondio";
    expect(ollamaHeaders()).toEqual({});
  });

  it("encode identifiant:motdepasse en base64", () => {
    process.env.OLLAMA_USER = "fondio";
    process.env.OLLAMA_PASSWORD = "secret";
    // "fondio:secret" en base64
    expect(ollamaHeaders().Authorization).toBe(`Basic ${btoa("fondio:secret")}`);
  });
});

describe("ollamaFetch", () => {
  it("appelle l'URL configurée avec l'en-tête d'authentification", async () => {
    process.env.OLLAMA_BASE_URL = "https://ai.exemple.fr";
    process.env.OLLAMA_USER = "fondio";
    process.env.OLLAMA_PASSWORD = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await ollamaFetch("/api/tags");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ai.exemple.fr/api/tags");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("fondio:secret")}`);
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("transforme un 401 en erreur d'authentification explicite", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(ollamaFetch("/api/chat")).rejects.toThrow(OLLAMA_AUTH_ERROR);
  });

  it("laisse passer les autres statuts à l'appelant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const res = await ollamaFetch("/api/chat");
    expect(res.status).toBe(404);
  });
});
