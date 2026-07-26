import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, queryOn, type SupabaseMock } from "@/test/helpers/supabase";

// Dépendances externes mockées : le client Supabase, le test de clé BYOK (réseau)
// et le chiffrement (dépend d'une clé d'env). La logique de garde (auth, provider
// valide, préféré retombant sur null) reste réelle.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm", () => ({ testByokKey: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: vi.fn(() => "enc:1:2") }));

import { createClient } from "@/lib/supabase/server";
import { testByokKey } from "@/lib/llm";
import { DELETE, POST, PUT } from "./route";

const createClientMock = vi.mocked(createClient);
const testByokKeyMock = vi.mocked(testByokKey);

function useSupabase(mock: SupabaseMock) {
  createClientMock.mockReturnValue(mock as unknown as ReturnType<typeof createClient>);
}

function req(method: string, body: unknown): Request {
  return new Request("http://localhost/api/account/api-keys", {
    method,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  createClientMock.mockReset();
  testByokKeyMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/account/api-keys", () => {
  it("401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null }));
    const res = await POST(req("POST", { provider: "anthropic", apiKey: "sk-x" }));
    expect(res.status).toBe(401);
  });

  it("400 quand le provider est invalide", async () => {
    useSupabase(createSupabaseMock());
    const res = await POST(req("POST", { provider: "acme", apiKey: "sk-x" }));
    expect(res.status).toBe(400);
  });

  it("400 quand apiKey est vide", async () => {
    useSupabase(createSupabaseMock());
    const res = await POST(req("POST", { provider: "anthropic", apiKey: "   " }));
    expect(res.status).toBe(400);
  });

  it("400 quand la clé échoue au test BYOK", async () => {
    useSupabase(createSupabaseMock());
    testByokKeyMock.mockResolvedValueOnce({ ok: false, error: "401 invalid" });
    const res = await POST(req("POST", { provider: "anthropic", apiKey: "sk-bad" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Clé invalide/);
  });

  it("enregistre la clé chiffrée (upsert) et renvoie ok", async () => {
    const mock = createSupabaseMock();
    useSupabase(mock);
    testByokKeyMock.mockResolvedValueOnce({ ok: true });
    const res = await POST(req("POST", { provider: "anthropic", apiKey: "  sk-good  " }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // La clé est trimée avant test et chiffrement.
    expect(testByokKeyMock).toHaveBeenCalledWith("anthropic", "sk-good");
    const upsert = queryOn(mock, "user_api_keys")?.calls.find((c) => c.fn === "upsert");
    expect(upsert).toBeDefined();
    expect((upsert!.args[0] as { provider: string }).provider).toBe("anthropic");
  });
});

describe("DELETE /api/account/api-keys", () => {
  it("401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null }));
    expect((await DELETE(req("DELETE", { provider: "anthropic" }))).status).toBe(401);
  });

  it("400 quand le provider est invalide", async () => {
    useSupabase(createSupabaseMock());
    expect((await DELETE(req("DELETE", { provider: "nope" }))).status).toBe(400);
  });

  it("supprime la clé et remet le provider préféré à null s'il correspondait", async () => {
    const mock = createSupabaseMock({
      handler: (q) => {
        if (q.table === "profiles" && q.calls.some((c) => c.fn === "select")) {
          return { data: { preferred_ai_provider: "anthropic" } };
        }
        return { data: null, error: null };
      },
    });
    useSupabase(mock);
    const res = await DELETE(req("DELETE", { provider: "anthropic" }));
    expect(res.status).toBe(200);
    const del = queryOn(mock, "user_api_keys")?.calls.find((c) => c.fn === "delete");
    expect(del).toBeDefined();
    // Comme le préféré == provider supprimé, on a remis à null via profiles.update.
    const profilesUpdate = mock.queries
      .filter((q) => q.table === "profiles")
      .some((q) => q.calls.some((c) => c.fn === "update"));
    expect(profilesUpdate).toBe(true);
  });
});

describe("PUT /api/account/api-keys (choix du provider préféré)", () => {
  it("401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null }));
    expect((await PUT(req("PUT", { preferredProvider: "anthropic" }))).status).toBe(401);
  });

  it("400 quand preferredProvider n'est ni null ni un provider connu", async () => {
    useSupabase(createSupabaseMock());
    expect((await PUT(req("PUT", { preferredProvider: "acme" }))).status).toBe(400);
  });

  it("400 quand on choisit un provider sans clé enregistrée", async () => {
    // keyRow introuvable → single renvoie data null.
    useSupabase(createSupabaseMock({ handler: () => ({ data: null }) }));
    const res = await PUT(req("PUT", { preferredProvider: "anthropic" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Aucune clé/);
  });

  it("accepte null (retour à Local/Mistral) sans exiger de clé", async () => {
    const mock = createSupabaseMock();
    useSupabase(mock);
    const res = await PUT(req("PUT", { preferredProvider: null }));
    expect(res.status).toBe(200);
    const update = queryOn(mock, "profiles")?.calls.find((c) => c.fn === "update");
    expect((update!.args[0] as { preferred_ai_provider: unknown }).preferred_ai_provider).toBeNull();
  });

  it("accepte un provider disposant d'une clé", async () => {
    const mock = createSupabaseMock({
      handler: (q) =>
        q.table === "user_api_keys" ? { data: { id: "k1" } } : { data: null, error: null },
    });
    useSupabase(mock);
    const res = await PUT(req("PUT", { preferredProvider: "openai" }));
    expect(res.status).toBe(200);
  });
});
