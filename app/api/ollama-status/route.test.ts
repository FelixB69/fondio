import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/helpers/supabase";

// Seul le client Supabase et fetch (sonde Ollama) sont mockés. La config des
// modèles (MODELS, BYOK_CHAT_MODELS, byokDisplayLabel) reste réelle : c'est
// précisément le contrat que la route expose à ModelSelector.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

const createClientMock = vi.mocked(createClient);
const originalFetch = global.fetch;

function useSupabase(mock: SupabaseMock) {
  createClientMock.mockReturnValue(mock as unknown as ReturnType<typeof createClient>);
}

beforeEach(() => {
  createClientMock.mockReset();
  global.fetch = vi.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("GET /api/ollama-status", () => {
  it("available:true quand Ollama répond, byok null sans utilisateur", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true } as Response);
    useSupabase(createSupabaseMock({ user: null }));

    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.byok).toBeNull();
    // La config des modèles réels est bien renvoyée.
    expect(body.local).toBeTruthy();
    expect(body.cloud).toBeTruthy();
  });

  it("available:false quand la sonde Ollama échoue (offline)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    useSupabase(createSupabaseMock({ user: null }));

    const body = await (await GET()).json();
    expect(body.available).toBe(false);
  });

  it("renvoie le statut BYOK quand l'utilisateur a un provider préféré + une clé", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true } as Response);
    useSupabase(
      createSupabaseMock({
        user: { id: "user-1" },
        handler: (q) => {
          if (q.table === "profiles") return { data: { preferred_ai_provider: "anthropic" } };
          if (q.table === "user_api_keys") return { data: { id: "k1" } };
          return { data: null };
        },
      }),
    );

    const body = await (await GET()).json();
    expect(body.byok).not.toBeNull();
    expect(body.byok.provider).toBe("anthropic");
    expect(body.byok.configured).toBe(true);
    expect(typeof body.byok.chatModel).toBe("string");
  });

  it("byok null quand l'utilisateur n'a aucun provider préféré", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true } as Response);
    useSupabase(
      createSupabaseMock({
        user: { id: "user-1" },
        handler: () => ({ data: { preferred_ai_provider: null } }),
      }),
    );

    const body = await (await GET()).json();
    expect(body.byok).toBeNull();
  });
});
