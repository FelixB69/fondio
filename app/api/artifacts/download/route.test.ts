import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/helpers/supabase";
import type { Artifact } from "@/lib/data";

// La route exige désormais une session : on mocke le client Supabase et on
// authentifie par défaut. Le test "401" fournit explicitement user: null.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { POST } from "./route";

const createClientMock = vi.mocked(createClient);
function useSupabase(mock: SupabaseMock) {
  createClientMock.mockReturnValue(mock as unknown as ReturnType<typeof createClient>);
}

beforeEach(() => {
  createClientMock.mockReset();
  useSupabase(createSupabaseMock()); // authentifié (user-1) par défaut
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/artifacts/download", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const table: Extract<Artifact, { kind: "table" }> = {
  kind: "table",
  title: "Étude de marché !",
  headers: ["Nom", "Prix"],
  rows: [
    ["Alpha, SARL", 'dit "bonjour"'],
    ["Bêta", "10€"],
  ],
};

const doc: Extract<Artifact, { kind: "document" }> = {
  kind: "document",
  title: "Cahier des charges",
  markdown: "# Objectif\n\n- **point fort**\n- second point",
};

describe("POST /api/artifacts/download — validation", () => {
  it("renvoie 401 quand non authentifié", async () => {
    useSupabase(createSupabaseMock({ user: null }));
    const res = await POST(post({ artifact: table, format: "csv" }));
    expect(res.status).toBe(401);
  });

  it("renvoie 400 sur un JSON invalide", async () => {
    const res = await POST(post("{ pas du json"));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 quand le tableau dépasse la limite de lignes", async () => {
    const huge: Artifact = {
      kind: "table",
      title: "Trop grand",
      headers: ["A"],
      rows: Array.from({ length: 5001 }, () => ["x"]),
    };
    const res = await POST(post({ artifact: huge, format: "csv" }));
    expect(res.status).toBe(400);
  });

  it("renvoie 400 quand artifact ou format manque", async () => {
    expect((await POST(post({ format: "csv" }))).status).toBe(400);
    expect((await POST(post({ artifact: table }))).status).toBe(400);
  });

  it("renvoie 400 quand le format ne correspond pas au type de livrable", async () => {
    // Un tableau ne peut pas sortir en md ; un document ne peut pas sortir en csv.
    expect((await POST(post({ artifact: table, format: "md" }))).status).toBe(400);
    expect((await POST(post({ artifact: doc, format: "csv" }))).status).toBe(400);
  });
});

describe("POST /api/artifacts/download — tableaux", () => {
  it("csv : échappe virgules et guillemets, en-têtes en 1re ligne", async () => {
    const res = await POST(post({ artifact: table, format: "csv" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toBe('Nom,Prix\r\n"Alpha, SARL","dit ""bonjour"""\r\nBêta,10€');
  });

  it("json : tableau d'objets clé=en-tête", async () => {
    const res = await POST(post({ artifact: table, format: "json" }));
    expect(res.status).toBe(200);
    const parsed = JSON.parse(await res.text());
    expect(parsed).toEqual([
      { Nom: "Alpha, SARL", Prix: 'dit "bonjour"' },
      { Nom: "Bêta", Prix: "10€" },
    ]);
  });

  it("xlsx : buffer binaire non vide (signature ZIP)", async () => {
    const res = await POST(post({ artifact: table, format: "xlsx" }));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // conteneur ZIP
  });

  it("slugifie le titre accentué dans le nom de fichier", async () => {
    const res = await POST(post({ artifact: table, format: "csv" }));
    expect(res.headers.get("Content-Disposition")).toContain('filename="etude-de-marche.csv"');
  });
});

describe("POST /api/artifacts/download — documents", () => {
  it("md : préfixe le titre en h1", async () => {
    const res = await POST(post({ artifact: doc, format: "md" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Cahier des charges\n\n# Objectif\n\n- **point fort**\n- second point");
  });

  it("txt : retire le markdown (gras, puces, titres)", async () => {
    const res = await POST(post({ artifact: doc, format: "txt" }));
    const text = await res.text();
    expect(text).toContain("Cahier des charges");
    expect(text).toContain("Objectif");
    expect(text).toContain("• point fort");
    expect(text).not.toContain("**");
    expect(text).not.toContain("# ");
  });

  it("pdf : buffer commençant par %PDF", async () => {
    const res = await POST(post({ artifact: doc, format: "pdf" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("docx : buffer binaire non vide (signature ZIP)", async () => {
    const res = await POST(post({ artifact: doc, format: "docx" }));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
