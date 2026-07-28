import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, queryOn, type QueryState, type SupabaseMock } from "@/test/helpers/supabase";

// On mocke les I/O (Supabase, LLM, BYOK) mais on garde réel tout le cœur métier :
// buildProjectSummaryPrompt, buildDashboard, parseProjectSummary, parseAgentReply.
// Le test vérifie donc l'orchestration réelle — gardes, limitation de débit,
// nettoyage de la réponse, persistance — et pas des mocks entre eux.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/byok", () => ({ loadUserByokConfig: vi.fn(async () => null) }));
vi.mock("@/lib/llm", () => ({
  callChatModel: vi.fn(),
  describeLLMError: (e: unknown) => (e instanceof Error ? e.message : "Erreur LLM."),
}));

import { createClient } from "@/lib/supabase/server";
import { callChatModel } from "@/lib/llm";
import { POST } from "./route";

const createClientMock = vi.mocked(createClient);
const callMock = vi.mocked(callChatModel);

function useSupabase(mock: SupabaseMock) {
  createClientMock.mockReturnValue(mock as unknown as ReturnType<typeof createClient>);
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/project-summary", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const PROJECT = {
  id: "p1",
  name: "Site vitrine",
  stage: "dev",
  glossary: [],
  summary: null,
};

// Handler par défaut : le projet existe, il a une tâche et une session.
function handler(over: { project?: unknown } = {}) {
  return (state: QueryState) => {
    if (state.table === "projects") {
      const isUpdate = state.calls.some((c) => c.fn === "update");
      if (isUpdate) return { data: null, error: null };
      return { data: over.project === undefined ? PROJECT : over.project, error: null };
    }
    if (state.table === "tasks") {
      return {
        data: [
          {
            id: "t1",
            session_id: null,
            project_id: "p1",
            content: "Choisir l'hébergeur",
            status: "todo",
            priority: "normal",
            start_date: null,
            due_date: null,
            source_agent_id: null,
            created_at: "2026-07-20T00:00:00.000Z",
            completed_at: null,
            updated_at: "2026-07-20T00:00:00.000Z",
            comments: [],
          },
        ],
        error: null,
      };
    }
    if (state.table === "sessions") {
      return {
        data: [
          {
            id: "s1",
            agent_id: "pm",
            title: "Cadrage",
            challenger_mode: false,
            messages: [],
            updated_at: "2026-07-21T00:00:00.000Z",
            panel_agent_ids: null,
          },
        ],
        error: null,
      };
    }
    return { data: null, error: null };
  };
}

function mockReply(text: string, provider = "local", providerLabel = "Mistral (local)") {
  callMock.mockResolvedValueOnce({ provider, providerLabel, data: text } as Awaited<
    ReturnType<typeof callChatModel>
  >);
}

beforeEach(() => {
  createClientMock.mockReset();
  callMock.mockReset();
  useSupabase(createSupabaseMock({ handler: handler() }));
});

describe("POST /api/project-summary — gardes", () => {
  it("renvoie 400 sur un JSON invalide", async () => {
    const res = await POST(post("{ pas du json"));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 sans projectId", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("renvoie 401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null, handler: handler() }));
    const res = await POST(post({ projectId: "p1" }));
    expect(res.status).toBe(401);
  });

  it("renvoie 404 quand le projet n'existe pas", async () => {
    useSupabase(createSupabaseMock({ handler: handler({ project: null }) }));
    const res = await POST(post({ projectId: "p1" }));
    expect(res.status).toBe(404);
  });

  it("restreint la lecture du projet à son propriétaire", async () => {
    const mock = createSupabaseMock({ handler: handler() });
    useSupabase(mock);
    mockReply("Votre projet avance.");
    await POST(post({ projectId: "p1" }));

    const q = queryOn(mock, "projects")!;
    const filters = q.calls.filter((c) => c.fn === "eq").map((c) => c.args);
    expect(filters).toContainEqual(["user_id", "user-1"]);
  });
});

describe("POST /api/project-summary — limitation de débit", () => {
  it("renvoie 429 si une synthèse date de moins d'une minute", async () => {
    const recent = {
      ...PROJECT,
      summary: {
        text: "Point précédent.",
        provider: "local",
        providerLabel: "Mistral (local)",
        generated_at: new Date(Date.now() - 10_000).toISOString(),
      },
    };
    useSupabase(createSupabaseMock({ handler: handler({ project: recent }) }));

    const res = await POST(post({ projectId: "p1" }));
    expect(res.status).toBe(429);
    // Et surtout : on n'a pas dépensé un appel au modèle pour rien.
    expect(callMock).not.toHaveBeenCalled();
  });

  it("regénère quand la synthèse précédente est plus ancienne", async () => {
    const old = {
      ...PROJECT,
      summary: {
        text: "Point précédent.",
        provider: "local",
        providerLabel: "Mistral (local)",
        generated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    };
    useSupabase(createSupabaseMock({ handler: handler({ project: old }) }));
    mockReply("Votre projet avance bien.");

    const res = await POST(post({ projectId: "p1" }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/project-summary — génération", () => {
  it("renvoie le texte et le provider réellement utilisé", async () => {
    mockReply("Votre projet est en développement.", "cloud", "Mistral Cloud");
    const res = await POST(post({ projectId: "p1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.text).toBe("Votre projet est en développement.");
    expect(body.providerLabel).toBe("Mistral Cloud");
    expect(Date.parse(body.generated_at)).not.toBeNaN();
  });

  it("retire une section produite malgré la consigne", async () => {
    mockReply("Votre projet avance bien.\n\nLIVRABLES:\n- Un planning\n");
    const res = await POST(post({ projectId: "p1" }));
    const body = await res.json();

    expect(body.text).not.toContain("LIVRABLES");
    expect(body.text).not.toContain("Un planning");
    expect(body.text).toContain("Votre projet avance bien.");
  });

  it("persiste la synthèse sur le projet", async () => {
    const mock = createSupabaseMock({ handler: handler() });
    useSupabase(mock);
    mockReply("Votre projet avance bien.");
    await POST(post({ projectId: "p1" }));

    const update = mock.queries
      .filter((q) => q.table === "projects")
      .flatMap((q) => q.calls)
      .find((c) => c.fn === "update");
    expect(update).toBeDefined();
    const payload = (update!.args[0] as { summary: Record<string, unknown> }).summary;
    expect(payload).toMatchObject({ provider: "local", providerLabel: "Mistral (local)" });
    expect(payload.text).toBe("Votre projet avance bien.");
  });

  it("renvoie 503 quand le modèle est injoignable", async () => {
    callMock.mockRejectedValueOnce(new Error("Ollama injoignable."));
    const res = await POST(post({ projectId: "p1" }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("Ollama injoignable.");
  });

  it("renvoie 503 sur une réponse vide", async () => {
    mockReply("   ");
    const res = await POST(post({ projectId: "p1" }));
    expect(res.status).toBe(503);
  });
});
