import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type QueryState, type SupabaseMock } from "@/test/helpers/supabase";

// On mocke les I/O (Supabase, streaming LLM, recherche web, artefacts, BYOK) mais
// on GARDE réel tout le cœur métier : buildSystemPrompt (data), parseAgentReply,
// glossary, projects. Le test vérifie donc l'orchestration réelle de la route
// (gardes, parsing du flux, persistance) et pas seulement des mocks entre eux.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/byok", () => ({ loadUserByokConfig: vi.fn(async () => null) }));
vi.mock("@/lib/web-search", () => ({
  gatherWebContext: vi.fn(async () => ({ webContext: "", sources: [] })),
}));
vi.mock("@/lib/artifacts", () => ({ generateArtifacts: vi.fn(async () => []) }));
vi.mock("@/lib/llm", () => ({
  callChatModelStream: vi.fn(),
  describeLLMError: (e: unknown) => (e instanceof Error ? e.message : "Erreur LLM."),
}));

import { createClient } from "@/lib/supabase/server";
import { callChatModelStream } from "@/lib/llm";
import { gatherWebContext } from "@/lib/web-search";
import { generateArtifacts } from "@/lib/artifacts";
import { POST } from "./route";

const createClientMock = vi.mocked(createClient);
const streamMock = vi.mocked(callChatModelStream);
const gatherMock = vi.mocked(gatherWebContext);
const artifactsMock = vi.mocked(generateArtifacts);

function useSupabase(mock: SupabaseMock) {
  createClientMock.mockReturnValue(mock as unknown as ReturnType<typeof createClient>);
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) });
}

// Flux LLM = itérable async de chunks texte.
async function* textStream(chunks: string[]) {
  for (const c of chunks) yield c;
}
function mockStream(chunks: string[], provider = "local", providerLabel = "Ollama local") {
  streamMock.mockResolvedValueOnce({
    provider,
    providerLabel,
    data: textStream(chunks),
  } as unknown as Awaited<ReturnType<typeof callChatModelStream>>);
}

// Lit un corps NDJSON (une ligne = un événement JSON) en tableau d'objets.
async function readNdjson(res: Response): Promise<Array<{ t: string; [k: string]: unknown }>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const baseSession = {
  id: "s1",
  agent_id: "pm",
  project_type: "web",
  challenger_mode: false,
  messages: [] as unknown[],
  title: null,
  project_id: null,
  guided: false,
};

// Handler DB pour le chemin nominal (session sans projet).
function sessionHandler(session: Record<string, unknown> = baseSession) {
  return (q: QueryState) => {
    if (q.table === "sessions") {
      if (q.calls.some((c) => c.fn === "single")) return { data: session };
      if (q.calls.some((c) => c.fn === "update")) return { error: null };
      return { data: [] }; // prevSessions
    }
    return { data: null, error: null };
  };
}

beforeEach(() => {
  createClientMock.mockReset();
  streamMock.mockReset();
  gatherMock.mockClear();
  artifactsMock.mockClear();
  gatherMock.mockResolvedValue({ webContext: "", sources: [] });
  artifactsMock.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/chat — gardes", () => {
  it("400 quand sessionId manque", async () => {
    useSupabase(createSupabaseMock());
    expect((await POST(post({ userMessage: "Salut" }))).status).toBe(400);
  });

  it("400 quand userMessage est vide (hors régénération)", async () => {
    useSupabase(createSupabaseMock());
    expect((await POST(post({ sessionId: "s1", userMessage: "   " }))).status).toBe(400);
  });

  it("401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null }));
    expect((await POST(post({ sessionId: "s1", userMessage: "Salut" }))).status).toBe(401);
  });

  it("404 quand la session est introuvable", async () => {
    useSupabase(createSupabaseMock({ handler: () => ({ data: null, error: { message: "x" } }) }));
    expect((await POST(post({ sessionId: "s1", userMessage: "Salut" }))).status).toBe(404);
  });

  it("400 quand l'agent de la session est inconnu", async () => {
    useSupabase(
      createSupabaseMock({ handler: sessionHandler({ ...baseSession, agent_id: "inconnu" }) }),
    );
    expect((await POST(post({ sessionId: "s1", userMessage: "Salut" }))).status).toBe(400);
  });

  it("503 quand le modèle est injoignable au démarrage du flux", async () => {
    useSupabase(createSupabaseMock({ handler: sessionHandler() }));
    streamMock.mockRejectedValueOnce(new Error("Ollama offline"));
    const res = await POST(post({ sessionId: "s1", userMessage: "Salut" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Ollama offline");
  });
});

describe("POST /api/chat — flux nominal", () => {
  it("streame provider → chunks → text-done → done et persiste la réponse", async () => {
    const mock = createSupabaseMock({ handler: sessionHandler() });
    useSupabase(mock);
    mockStream(["Bonjour", " le monde"]);

    const res = await POST(post({ sessionId: "s1", userMessage: "Salut" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("x-ndjson");

    const events = await readNdjson(res);
    const types = events.map((e) => e.t);
    expect(types[0]).toBe("provider");
    expect(types).toContain("chunk");
    expect(types).toContain("text-done");
    expect(types[types.length - 1]).toBe("done");

    const provider = events.find((e) => e.t === "provider")!;
    expect(provider.provider).toBe("local");

    const textDone = events.find((e) => e.t === "text-done") as unknown as {
      assistant: { content: string; role: string };
    };
    expect(textDone.assistant.role).toBe("assistant");
    expect(textDone.assistant.content).toBe("Bonjour le monde");

    // Persistance : un update sessions a bien eu lieu.
    const updated = mock.queries.some(
      (q) => q.table === "sessions" && q.calls.some((c) => c.fn === "update"),
    );
    expect(updated).toBe(true);
  });

  it("émet une erreur de flux quand la réponse du modèle est vide", async () => {
    useSupabase(createSupabaseMock({ handler: sessionHandler() }));
    mockStream(["   "]);
    const events = await readNdjson(await POST(post({ sessionId: "s1", userMessage: "Salut" })));
    expect(events.some((e) => e.t === "error")).toBe(true);
  });

  it("ne déclenche pas la recherche web quand webSearch est absent", async () => {
    useSupabase(createSupabaseMock({ handler: sessionHandler() }));
    mockStream(["Réponse"]);
    await readNdjson(await POST(post({ sessionId: "s1", userMessage: "Salut" })));
    expect(gatherMock).not.toHaveBeenCalled();
  });

  it("déclenche la recherche web quand webSearch est activé", async () => {
    useSupabase(createSupabaseMock({ handler: sessionHandler() }));
    gatherMock.mockResolvedValueOnce({
      webContext: "\n\nInfos web...",
      sources: [{ title: "Src", url: "https://s" }],
    });
    mockStream(["Réponse avec [1]"]);
    const events = await readNdjson(
      await POST(post({ sessionId: "s1", userMessage: "Prix du marché ?", webSearch: true })),
    );
    expect(gatherMock).toHaveBeenCalledTimes(1);
    // Les sources sont accrochées au message persisté.
    const textDone = events.find((e) => e.t === "text-done") as unknown as {
      assistant: { sources?: { url: string }[] };
    };
    expect(textDone.assistant.sources?.[0].url).toBe("https://s");
  });
});
