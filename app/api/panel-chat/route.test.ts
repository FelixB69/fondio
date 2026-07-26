import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type QueryState, type SupabaseMock } from "@/test/helpers/supabase";

// Même stratégie que la route chat : I/O mockées, cœur métier (prompts panel +
// synthèse, parseAgentReply, glossary) réel.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/web-search", () => ({
  gatherWebContext: vi.fn(async () => ({ webContext: "", sources: [] })),
}));
vi.mock("@/lib/artifacts", () => ({ generateArtifacts: vi.fn(async () => []) }));
vi.mock("@/lib/llm", () => ({ callChatModelStream: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { callChatModelStream } from "@/lib/llm";
import { POST } from "./route";

const createClientMock = vi.mocked(createClient);
const streamMock = vi.mocked(callChatModelStream);

function useSupabase(mock: SupabaseMock) {
  createClientMock.mockReturnValue(mock as unknown as ReturnType<typeof createClient>);
}
function post(body: unknown): Request {
  return new Request("http://localhost/api/panel-chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function* textStream(chunks: string[]) {
  for (const c of chunks) yield c;
}
// Enfile UN appel de flux (un agent, ou la synthèse).
function pushStream(chunks: string[], provider = "local", providerLabel = "Ollama local") {
  streamMock.mockResolvedValueOnce({
    provider,
    providerLabel,
    data: textStream(chunks),
  } as unknown as Awaited<ReturnType<typeof callChatModelStream>>);
}

async function readNdjson(res: Response): Promise<Array<{ t: string; [k: string]: unknown }>> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const baseSession = {
  id: "s1",
  project_type: "web",
  challenger_mode: false,
  messages: [] as unknown[],
  title: null,
  panel_agent_ids: ["pm", "architect"],
  project_id: null,
};

function sessionHandler(session: Record<string, unknown> = baseSession) {
  return (q: QueryState) => {
    if (q.table === "sessions") {
      if (q.calls.some((c) => c.fn === "single")) return { data: session };
      return { data: null, error: null }; // update
    }
    if (q.table === "tasks") return { data: [] };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  createClientMock.mockReset();
  streamMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/panel-chat — gardes", () => {
  it("400 quand sessionId ou userMessage manque", async () => {
    useSupabase(createSupabaseMock());
    expect((await POST(post({ userMessage: "Salut" }))).status).toBe(400);
    expect((await POST(post({ sessionId: "s1", userMessage: " " }))).status).toBe(400);
  });

  it("401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null }));
    expect((await POST(post({ sessionId: "s1", userMessage: "Salut" }))).status).toBe(401);
  });

  it("404 quand la session est introuvable", async () => {
    useSupabase(createSupabaseMock({ handler: () => ({ data: null, error: { message: "x" } }) }));
    expect((await POST(post({ sessionId: "s1", userMessage: "Salut" }))).status).toBe(404);
  });

  it("400 quand le panel a moins de 2 agents valides", async () => {
    useSupabase(
      createSupabaseMock({ handler: sessionHandler({ ...baseSession, panel_agent_ids: ["pm"] }) }),
    );
    expect((await POST(post({ sessionId: "s1", userMessage: "Salut" }))).status).toBe(400);
  });
});

describe("POST /api/panel-chat — flux nominal", () => {
  it("fait répondre chaque agent puis la synthèse, et persiste", async () => {
    const mock = createSupabaseMock({ handler: sessionHandler() });
    useSupabase(mock);
    // 2 agents + 1 synthèse = 3 flux.
    pushStream(["Avis de Clara"]);
    pushStream(["Avis de Malik"]);
    pushStream(["Synthèse finale"]);

    const res = await POST(post({ sessionId: "s1", userMessage: "Par où commencer ?" }));
    expect(res.status).toBe(200);
    const events = await readNdjson(res);
    const types = events.map((e) => e.t);

    expect(types[0]).toBe("title");
    expect(events.filter((e) => e.t === "agent-start").map((e) => e.agentId)).toEqual([
      "pm",
      "architect",
    ]);
    expect(events.filter((e) => e.t === "agent-done")).toHaveLength(2);
    expect(types).toContain("synthesis-start");

    const synthDone = events.find((e) => e.t === "synthesis-done") as unknown as {
      message: { agentId: string; content: string };
    };
    expect(synthDone.message.agentId).toBe("__synthesis__");
    expect(synthDone.message.content).toBe("Synthèse finale");
    expect(types[types.length - 1]).toBe("done");
    expect(streamMock).toHaveBeenCalledTimes(3);

    // Persistance finale : agents + synthèse.
    expect(
      mock.queries.some(
        (q) => q.table === "sessions" && q.calls.some((c) => c.fn === "update"),
      ),
    ).toBe(true);
  });

  it("best-effort : si la synthèse plante, on émet une erreur et on garde les avis", async () => {
    const mock = createSupabaseMock({ handler: sessionHandler() });
    useSupabase(mock);
    pushStream(["Avis de Clara"]);
    pushStream(["Avis de Malik"]);
    streamMock.mockRejectedValueOnce(new Error("synthèse KO")); // la synthèse échoue

    const events = await readNdjson(
      await POST(post({ sessionId: "s1", userMessage: "Par où commencer ?" })),
    );
    // Les 2 agents ont bien répondu avant l'échec.
    expect(events.filter((e) => e.t === "agent-done")).toHaveLength(2);
    // Une erreur est signalée, pas de synthesis-done.
    expect(events.some((e) => e.t === "error")).toBe(true);
    expect(events.some((e) => e.t === "synthesis-done")).toBe(false);
    // On a tout de même persisté les avis produits.
    expect(
      mock.queries.some(
        (q) => q.table === "sessions" && q.calls.some((c) => c.fn === "update"),
      ),
    ).toBe(true);
  });
});
