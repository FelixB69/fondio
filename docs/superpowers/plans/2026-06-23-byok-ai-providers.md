# BYOK — Connecter sa propre clé API IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Fondio user connect their own API key (Anthropic, OpenAI, Google, or Mistral) as a global preferred provider, used for chat (streaming), deliverable formatting, and web-search tool-calling, with automatic fallback to Local/Mistral Fondio on failure.

**Architecture:** `lib/llm.ts` gains a third provider tier ("byok") alongside the existing local (Ollama) / cloud (Mistral Fondio) tiers. Each BYOK provider gets adapter functions (`*Json`/`*Stream`/`*Tools`) translating the existing normalized message/tool formats to/from the provider's own API shape — mirroring the pattern already used for Ollama vs Mistral. A new `user_api_keys` Supabase table (AES-256-GCM encrypted server-side) plus `profiles.preferred_ai_provider` store the user's choice; `lib/byok.ts` loads/decrypts it per request. `app/api/chat/route.ts`, `lib/web-search.ts`, and `lib/artifacts.ts` thread this config through to `lib/llm.ts`. `AccountScreen.tsx` gets a UI section to manage keys; `ModelSelector.tsx`'s existing "Cloud" option dynamically reflects the chosen BYOK provider.

**Tech Stack:** Next.js 14 (App Router, Node runtime), TypeScript, Supabase (Postgres + RLS), vitest for unit tests, Node's built-in `crypto` module for encryption.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-06-23-byok-ai-providers-design.md`.
- 4 BYOK providers: `anthropic`, `openai`, `google`, `mistral_byok`. One fixed default model per provider for v1 (no model picker UI).
- Fallback order on any failure: BYOK → Local (Ollama) → Mistral Fondio. Never block the user.
- API keys are never returned to the client after initial save; never logged in full (truncate/redact in error messages).
- Auth on every new/modified API route via `getUser()` from `lib/supabase/server.ts`, JSON responses, explicit HTTP status codes — per `CLAUDE.md`.
- `supabase/schema.sql` changes: isolated `ALTER TABLE`/`CREATE TABLE` statements only, written to a separate migration file — never rewrite `schema.sql` wholesale (it has dropped a live table before).
- Encryption secret lives only in a server-side env var (`API_KEY_ENCRYPTION_SECRET`), never committed, never sent to the client, never stored in the database.
- French inline comments only where the WHY is non-obvious, matching existing codebase style. No comments restating WHAT the code does.

---

## Task 1: Database migration — `user_api_keys` table + `preferred_ai_provider`

**Files:**
- Create: `supabase/migrations/2026-06-23-byok-api-keys.sql`

**Interfaces:**
- Produces: table `public.user_api_keys(id, user_id, provider, encrypted_key, created_at, updated_at)` with RLS scoped to `auth.uid() = user_id`; column `public.profiles.preferred_ai_provider` (nullable text, checked against the 4 provider ids).
- These are consumed by Task 8 (`lib/byok.ts`) and Task 9 (`app/api/account/api-keys/route.ts`).

- [ ] **Step 1: Write the migration file**

```sql
-- BYOK : clés API personnelles + provider préféré.
-- Isolé du schema.sql principal — à lancer manuellement dans le SQL editor
-- Supabase (ou via la CLI). Ne PAS fusionner dans schema.sql tel quel : on
-- garde une trace par migration depuis l'incident de drop de "projects".

-- =====================================================================
-- user_api_keys — une clé chiffrée par (utilisateur, fournisseur).
-- Le chiffrement (AES-256-GCM) se fait côté Node, PAS en SQL : la colonne ne
-- contient qu'un texte déjà opaque (base64 de iv + ciphertext + authTag).
-- =====================================================================
create table if not exists public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'mistral_byok')),
  encrypted_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.user_api_keys enable row level security;

drop policy if exists "user_api_keys_own" on public.user_api_keys;
create policy "user_api_keys_own" on public.user_api_keys
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- profiles.preferred_ai_provider — null = comportement actuel (Local/Mistral
-- Fondio). Sinon, un des 4 fournisseurs BYOK devient le tier "cloud" par défaut.
-- =====================================================================
alter table public.profiles
  add column if not exists preferred_ai_provider text
  check (preferred_ai_provider in ('anthropic', 'openai', 'google', 'mistral_byok'));
```

- [ ] **Step 2: Apply it to your local/dev Supabase project**

Run this SQL in the Supabase SQL editor (or `supabase db execute -f supabase/migrations/2026-06-23-byok-api-keys.sql` if using the CLI locally). Verify it applied:

```sql
select column_name from information_schema.columns
where table_name = 'profiles' and column_name = 'preferred_ai_provider';
-- expect 1 row

select table_name from information_schema.tables
where table_name = 'user_api_keys';
-- expect 1 row
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-06-23-byok-api-keys.sql
git commit -m "feat: ajoute la table user_api_keys et profiles.preferred_ai_provider"
```

---

## Task 2: `lib/crypto.ts` — encrypt/decrypt API keys at rest

**Files:**
- Create: `lib/crypto.ts`
- Test: `lib/crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain: string): string`, `decryptSecret(encrypted: string): string`. Both pure, no I/O. Consumed by Task 8 (`lib/byok.ts`) and Task 9 (API route).
- Consumes: env var `API_KEY_ENCRYPTION_SECRET` (must be a 64-char hex string = 32 bytes, for AES-256).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", () => {
    const plain = "sk-ant-test-1234567890";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = "sk-ant-test-1234567890";
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptSecret("sk-ant-test");
    const tampered = encrypted.slice(0, -2) + "00";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/crypto.test.ts`
Expected: FAIL — `Cannot find module './crypto'`

- [ ] **Step 3: Write the implementation**

```typescript
// Chiffrement des clés API utilisateur au repos (table user_api_keys).
// AES-256-GCM : authentifié (détecte toute altération du ciphertext, contre
// pgcrypto qui aurait demandé une fonction SQL + gestion du secret côté DB —
// ici le secret ne quitte jamais l'environnement serveur Node).
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // recommandé pour GCM

function getKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET manquante ou invalide (attendu : 64 caractères hexadécimaux / 32 octets).",
    );
  }
  return Buffer.from(hex, "hex");
}

// Format de sortie : base64(iv) + "." + base64(authTag) + "." + base64(ciphertext)
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("Format de clé chiffrée invalide.");
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/crypto.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the env var documentation**

In `.env.example`, add after the Tavily section:

```
# BYOK : secret de chiffrement des clés API utilisateur (table user_api_keys).
# 32 octets en hexadécimal (64 caractères). Générer avec :
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Ne JAMAIS commiter la vraie valeur. La changer = perdre l'accès aux clés déjà stockées.
API_KEY_ENCRYPTION_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add lib/crypto.ts lib/crypto.test.ts .env.example
git commit -m "feat: ajoute le chiffrement AES-256-GCM des clés API utilisateur"
```

---

## Task 3: `lib/llm.ts` — BYOK types + Anthropic adapter

**Files:**
- Modify: `lib/llm.ts`
- Test: `lib/llm.test.ts` (new)

**Interfaces:**
- Produces: `export type BYOKProviderId = "anthropic" | "openai" | "google" | "mistral_byok"`, `export interface BYOKConfig { provider: BYOKProviderId; apiKey: string }`, and (module-private to `lib/llm.ts`) `callAnthropicJson(messages: LLMMessage[], apiKey: string, model: string): Promise<string>`, `callAnthropicStream(messages: LLMMessage[], apiKey: string, model: string): Promise<AsyncIterable<string>>`, `callAnthropicTools(messages: ToolLoopMessage[], tools: ToolDef[], apiKey: string, model: string): Promise<ToolTurnResult>`.
- Consumes: existing `LLMMessage`, `ToolLoopMessage`, `ToolDef`, `ToolCall`, `ToolTurnResult`, `safeParseArgs` already defined in `lib/llm.ts`.

- [ ] **Step 1: Write the failing test**

Create `lib/llm.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAnthropicJsonForTest as callAnthropicJson } from "./llm";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Anthropic adapter — callAnthropicJson", () => {
  it("sends system separately and parses text content blocks", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Bonjour" }] }),
    });

    const result = await callAnthropicJson(
      [
        { role: "system", content: "Tu es un assistant." },
        { role: "user", content: "Salut" },
      ],
      "sk-ant-test",
      "claude-sonnet-4-6",
    );

    expect(result).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("Tu es un assistant.");
    expect(body.messages).toEqual([{ role: "user", content: "Salut" }]);
  });

  it("throws with status on non-ok response", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid key" });
    await expect(
      callAnthropicJson([{ role: "user", content: "x" }], "bad-key", "claude-sonnet-4-6"),
    ).rejects.toThrow(/401/);
  });
});
```

Since `callAnthropicJson` is currently module-private, temporarily export it under a test-only alias at the bottom of `lib/llm.ts` (we'll fold this into the real public `testByokKey` export in Task 6 — for now just add a minimal export so the test can target the function directly):

```typescript
// Alias d'export réservé aux tests — la fonction reste interne au module pour
// le code applicatif (accédée via callByokJson dans Task 6).
export { callAnthropicJson as callAnthropicJsonForTest };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/llm.test.ts`
Expected: FAIL — `callAnthropicJson is not defined` / module export missing

- [ ] **Step 3: Implement the Anthropic adapter**

In `lib/llm.ts`, after the existing `MISTRAL_*` env var declarations near the top, add:

```typescript
// ── BYOK (Bring Your Own Key) ───────────────────────────────────────────────
//
// Un 3e tier de provider, en plus de local (Ollama) et cloud (Mistral Fondio) :
// l'utilisateur fournit sa propre clé API. Chaque fournisseur a son propre
// format de message / tool-calling ; on traduit depuis/vers les types
// normalisés déjà utilisés pour Ollama/Mistral (LLMMessage, ToolLoopMessage).

export type BYOKProviderId = "anthropic" | "openai" | "google" | "mistral_byok";

export interface BYOKConfig {
  provider: BYOKProviderId;
  apiKey: string;
}

const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 8192;

// Anthropic veut le system prompt à part (pas dans le tableau messages).
function splitSystemMessage(messages: LLMMessage[]): { system: string; rest: LLMMessage[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return { system, rest };
}

async function callAnthropicJson(
  messages: LLMMessage[],
  apiKey: string,
  model: string,
): Promise<string> {
  const { system, rest } = splitSystemMessage(messages);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const raw = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!raw) throw new Error("Réponse vide du modèle.");
  return raw;
}

async function callAnthropicStream(
  messages: LLMMessage[],
  apiKey: string,
  model: string,
): Promise<AsyncIterable<string>> {
  const { system, rest } = splitSystemMessage(messages);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      stream: true,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  return anthropicStreamToText(res.body);
}

async function* anthropicStreamToText(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const json = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && json.delta.text) {
          yield json.delta.text;
        }
      } catch {
        // ligne SSE partielle, ignore
      }
    }
  }
}

function toAnthropicTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function toAnthropicMessages(messages: ToolLoopMessage[]): { system: string; rest: unknown[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.toolCalls.map((t) => ({
              type: "tool_use",
              id: t.id,
              name: t.name,
              input: safeParseArgs(t.arguments),
            })),
          ],
        };
      }
      if (m.role === "tool") {
        return {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
        };
      }
      return { role: m.role, content: m.content };
    });
  return { system, rest };
}

async function callAnthropicTools(
  messages: ToolLoopMessage[],
  tools: ToolDef[],
  apiKey: string,
  model: string,
): Promise<ToolTurnResult> {
  const { system, rest } = toAnthropicMessages(messages);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      messages: rest,
      tools: toAnthropicTools(tools),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic tools ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  };
  const blocks = json.content ?? [];
  const content = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id ?? "", name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) }));
  return { content, toolCalls };
}

export { callAnthropicJson as callAnthropicJsonForTest };
```

Place this block right after the `safeParseArgs` function definition (so `ToolDef`, `ToolCall`, `ToolLoopMessage`, `ToolTurnResult`, `safeParseArgs` are already in scope).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/llm.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/llm.ts lib/llm.test.ts
git commit -m "feat: ajoute l'adaptateur Anthropic (BYOK) dans lib/llm.ts"
```

---

## Task 4: `lib/llm.ts` — generic OpenAI-compatible adapter (OpenAI + Mistral BYOK)

**Files:**
- Modify: `lib/llm.ts`
- Modify: `lib/llm.test.ts`

**Interfaces:**
- Produces (module-private, used in Task 6): `callOpenAICompatibleJson(baseUrl: string, apiKey: string, model: string, messages: LLMMessage[], opts?: { jsonMode?: boolean }): Promise<string>`, `callOpenAICompatibleStream(baseUrl, apiKey, model, messages): Promise<AsyncIterable<string>>`, `callOpenAICompatibleTools(baseUrl, apiKey, model, messages: ToolLoopMessage[], tools: ToolDef[]): Promise<ToolTurnResult>`.
- Consumes: existing `toMistralToolMessages` and `mistralStreamToText` (already defined earlier in `lib/llm.ts` — OpenAI and Mistral share the same Chat Completions / SSE wire format, so no need to duplicate those translators).

- [ ] **Step 1: Write the failing test**

Append to `lib/llm.test.ts`:

```typescript
import { callOpenAICompatibleJsonForTest as callOpenAICompatibleJson } from "./llm";

describe("OpenAI-compatible adapter — callOpenAICompatibleJson", () => {
  it("posts to {baseUrl}/chat/completions with Bearer auth", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Bonjour" } }] }),
    });

    const result = await callOpenAICompatibleJson(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o-mini",
      [{ role: "user", content: "Salut" }],
    );

    expect(result).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("throws on empty response", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }) });
    await expect(
      callOpenAICompatibleJson("https://api.openai.com/v1", "sk-test", "gpt-4o-mini", [
        { role: "user", content: "x" },
      ]),
    ).rejects.toThrow(/vide/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/llm.test.ts`
Expected: FAIL — `callOpenAICompatibleJsonForTest` not exported

- [ ] **Step 3: Implement the generic adapter**

In `lib/llm.ts`, right after the Anthropic block from Task 3, add:

```typescript
// OpenAI et Mistral (et donc "mistral_byok") parlent le même protocole Chat
// Completions : on factorise un seul adaptateur paramétré par baseUrl/clé/modèle,
// au lieu de dupliquer callMistralJson/Stream/Tools une 2e fois pour OpenAI.
async function callOpenAICompatibleJson(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  opts?: { jsonMode?: boolean },
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${baseUrl} ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Réponse vide du modèle.");
  return raw;
}

async function callOpenAICompatibleStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LLMMessage[],
): Promise<AsyncIterable<string>> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`${baseUrl} ${res.status}: ${text.slice(0, 200)}`);
  }
  return mistralStreamToText(res.body); // format SSE identique chez OpenAI/Mistral
}

async function callOpenAICompatibleTools(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ToolLoopMessage[],
  tools: ToolDef[],
): Promise<ToolTurnResult> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: toMistralToolMessages(messages),
      tools,
      tool_choice: "auto",
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${baseUrl} tools ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  return {
    content: msg?.content ?? "",
    toolCalls: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })),
  };
}

export { callOpenAICompatibleJson as callOpenAICompatibleJsonForTest };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/llm.test.ts`
Expected: PASS (4 tests total)

- [ ] **Step 5: Commit**

```bash
git add lib/llm.ts lib/llm.test.ts
git commit -m "feat: ajoute l'adaptateur OpenAI-compatible (OpenAI + Mistral BYOK)"
```

---

## Task 5: `lib/llm.ts` — Google Gemini adapter

**Files:**
- Modify: `lib/llm.ts`
- Modify: `lib/llm.test.ts`

**Interfaces:**
- Produces (module-private, used in Task 6): `callGoogleJson(messages: LLMMessage[], apiKey: string, model: string): Promise<string>`, `callGoogleStream(...): Promise<AsyncIterable<string>>`, `callGoogleTools(messages: ToolLoopMessage[], tools: ToolDef[], apiKey: string, model: string): Promise<ToolTurnResult>`.

- [ ] **Step 1: Write the failing test**

Append to `lib/llm.test.ts`:

```typescript
import { callGoogleJsonForTest as callGoogleJson } from "./llm";

describe("Google Gemini adapter — callGoogleJson", () => {
  it("moves system messages into systemInstruction and maps assistant->model", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Bonjour" }] } }] }),
    });

    const result = await callGoogleJson(
      [
        { role: "system", content: "Tu es un assistant." },
        { role: "user", content: "Salut" },
      ],
      "AIza-test",
      "gemini-2.0-flash",
    );

    expect(result).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("gemini-2.0-flash:generateContent?key=AIza-test");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("Tu es un assistant.");
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Salut" }] }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/llm.test.ts`
Expected: FAIL — `callGoogleJsonForTest` not exported

- [ ] **Step 3: Implement the Google adapter**

In `lib/llm.ts`, after the OpenAI-compatible block from Task 4, add:

```typescript
const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini ne connaît pas le rôle "system" dans `contents` : il faut le sortir
// dans `systemInstruction`, et "assistant" devient "model".
function toGeminiContents(messages: LLMMessage[]) {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents,
  };
}

async function callGoogleJson(messages: LLMMessage[], apiKey: string, model: string): Promise<string> {
  const { systemInstruction, contents } = toGeminiContents(messages);
  const res = await fetch(`${GOOGLE_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, ...(systemInstruction ? { systemInstruction } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!raw) throw new Error("Réponse vide du modèle.");
  return raw;
}

async function callGoogleStream(
  messages: LLMMessage[],
  apiKey: string,
  model: string,
): Promise<AsyncIterable<string>> {
  const { systemInstruction, contents } = toGeminiContents(messages);
  const res = await fetch(`${GOOGLE_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, ...(systemInstruction ? { systemInstruction } : {}) }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google ${res.status}: ${text.slice(0, 200)}`);
  }
  return googleStreamToText(res.body);
}

async function* googleStreamToText(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const json = JSON.parse(payload) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const chunk = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (chunk) yield chunk;
      } catch {
        // ligne SSE partielle, ignore
      }
    }
  }
}

function toGeminiTools(tools: ToolDef[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    },
  ];
}

function toGeminiToolContents(messages: ToolLoopMessage[]) {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "model",
          parts: m.toolCalls.map((t) => ({ functionCall: { name: t.name, args: safeParseArgs(t.arguments) } })),
        };
      }
      if (m.role === "tool") {
        return {
          role: "user",
          parts: [{ functionResponse: { name: m.name ?? "", response: { content: m.content } } }],
        };
      }
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
    });
  return { systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined, contents };
}

async function callGoogleTools(
  messages: ToolLoopMessage[],
  tools: ToolDef[],
  apiKey: string,
  model: string,
): Promise<ToolTurnResult> {
  const { systemInstruction, contents } = toGeminiToolContents(messages);
  const res = await fetch(`${GOOGLE_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, tools: toGeminiTools(tools), ...(systemInstruction ? { systemInstruction } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google tools ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
    }>;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const content = parts
    .filter((p) => p.text)
    .map((p) => p.text ?? "")
    .join("");
  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({
      id: `call_${i}`,
      name: p.functionCall!.name,
      arguments: JSON.stringify(p.functionCall!.args ?? {}),
    }));
  return { content, toolCalls };
}

export { callGoogleJson as callGoogleJsonForTest };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/llm.test.ts`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add lib/llm.ts lib/llm.test.ts
git commit -m "feat: ajoute l'adaptateur Google Gemini (BYOK)"
```

---

## Task 6: `lib/llm.ts` — BYOK dispatch + fallback integration

**Files:**
- Modify: `lib/llm.ts`
- Modify: `lib/llm.test.ts`

**Interfaces:**
- Produces: `export async function testByokKey(provider: BYOKProviderId, apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>` (consumed by Task 9's API route), `export function byokDisplayLabel(provider: BYOKProviderId): string` (consumed by Task 13/14 UI), extended `LLMProvider = "local" | "cloud" | "byok"`, and `callChatModel`/`callChatModelStream`/`callModelWithTools` now accept an optional `byok?: BYOKConfig | null` field.
- Consumes: everything produced in Tasks 3-5 (`callAnthropicJson/Stream/Tools`, `callOpenAICompatibleJson/Stream/Tools`, `callGoogleJson/Stream/Tools`), plus existing `callMistralJson`, `isOllamaUnavailable`, `cloudLabel`, `localLabel`.

- [ ] **Step 1: Write the failing test**

Append to `lib/llm.test.ts`:

```typescript
import { callChatModel, testByokKey } from "./llm";

describe("callChatModel with byok", () => {
  it("uses the byok provider when configured and forceProvider is not 'local'", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Réponse Claude" }] }),
    });

    const result = await callChatModel([{ role: "user", content: "Salut" }], {
      byok: { provider: "anthropic", apiKey: "sk-ant-test" },
    });

    expect(result.provider).toBe("byok");
    expect(result.data).toBe("Réponse Claude");
  });

  it("falls back to local/cloud when the byok call fails, without throwing", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    // 1er appel : Anthropic échoue (clé invalide)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid" });
    // 2e appel : Ollama (local) injoignable
    fetchMock.mockRejectedValueOnce(new Error("fetch failed"));
    // 3e appel : Mistral Fondio répond
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Réponse Mistral" } }] }),
    });
    process.env.MISTRAL_API_KEY = "fondio-test-key";

    const result = await callChatModel([{ role: "user", content: "Salut" }], {
      byok: { provider: "anthropic", apiKey: "sk-ant-bad" },
    });

    expect(result.provider).toBe("cloud");
    expect(result.data).toBe("Réponse Mistral");
  });

  it("ignores byok when forceProvider is 'local'", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "Réponse locale" } }),
    });

    const result = await callChatModel([{ role: "user", content: "Salut" }], {
      byok: { provider: "anthropic", apiKey: "sk-ant-test" },
      forceProvider: "local",
    });

    expect(result.provider).toBe("local");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/chat"); // Ollama, pas Anthropic
  });
});

describe("testByokKey", () => {
  it("returns ok:true on a successful test call", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const result = await testByokKey("anthropic", "sk-ant-test");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with the error message on failure", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid" });
    const result = await testByokKey("anthropic", "sk-ant-bad");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/401/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/llm.test.ts`
Expected: FAIL — `testByokKey is not exported`, and `callChatModel` doesn't recognize `byok` yet (result.provider stays `"local"`/`"cloud"` regardless).

- [ ] **Step 3: Wire up the dispatch + fallback**

In `lib/llm.ts`, after the Google adapter block from Task 5, add the dispatch layer:

```typescript
const BYOK_MODELS: Record<BYOKProviderId, { chat: string; artifact: string; label: string }> = {
  anthropic: { chat: "claude-sonnet-4-6", artifact: "claude-sonnet-4-6", label: "Claude Sonnet" },
  openai: { chat: "gpt-4o-mini", artifact: "gpt-4o-mini", label: "GPT-4o mini" },
  google: { chat: "gemini-2.0-flash", artifact: "gemini-2.0-flash", label: "Gemini Flash" },
  mistral_byok: { chat: "mistral-small-latest", artifact: "codestral-latest", label: "Mistral Small" },
};

export function byokDisplayLabel(provider: BYOKProviderId): string {
  return BYOK_MODELS[provider].label;
}

function byokProviderLabel(byok: BYOKConfig): string {
  return `${BYOK_MODELS[byok.provider].label} · votre clé`;
}

function byokModelFor(byok: BYOKConfig, opts?: CallOptions): string {
  return opts?.useArtifactModel ? BYOK_MODELS[byok.provider].artifact : BYOK_MODELS[byok.provider].chat;
}

async function callByokJson(byok: BYOKConfig, messages: LLMMessage[], opts?: CallOptions): Promise<string> {
  const model = byokModelFor(byok, opts);
  switch (byok.provider) {
    case "anthropic":
      return callAnthropicJson(messages, byok.apiKey, model);
    case "openai":
      return callOpenAICompatibleJson("https://api.openai.com/v1", byok.apiKey, model, messages, opts);
    case "google":
      return callGoogleJson(messages, byok.apiKey, model);
    case "mistral_byok":
      return callOpenAICompatibleJson("https://api.mistral.ai/v1", byok.apiKey, model, messages, opts);
  }
}

async function callByokStream(byok: BYOKConfig, messages: LLMMessage[]): Promise<AsyncIterable<string>> {
  const model = BYOK_MODELS[byok.provider].chat;
  switch (byok.provider) {
    case "anthropic":
      return callAnthropicStream(messages, byok.apiKey, model);
    case "openai":
      return callOpenAICompatibleStream("https://api.openai.com/v1", byok.apiKey, model, messages);
    case "google":
      return callGoogleStream(messages, byok.apiKey, model);
    case "mistral_byok":
      return callOpenAICompatibleStream("https://api.mistral.ai/v1", byok.apiKey, model, messages);
  }
}

async function callByokTools(
  byok: BYOKConfig,
  messages: ToolLoopMessage[],
  tools: ToolDef[],
): Promise<ToolTurnResult> {
  const model = BYOK_MODELS[byok.provider].chat;
  switch (byok.provider) {
    case "anthropic":
      return callAnthropicTools(messages, tools, byok.apiKey, model);
    case "openai":
      return callOpenAICompatibleTools("https://api.openai.com/v1", byok.apiKey, model, messages, tools);
    case "google":
      return callGoogleTools(messages, tools, byok.apiKey, model);
    case "mistral_byok":
      return callOpenAICompatibleTools("https://api.mistral.ai/v1", byok.apiKey, model, messages, tools);
  }
}

function describeByokError(byok: BYOKConfig, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const label = BYOK_MODELS[byok.provider].label;
  if (msg.includes("401") || msg.includes("403")) return `Clé ${label} invalide ou expirée.`;
  if (msg.includes("429")) return `Quota ${label} dépassé.`;
  return `${label} indisponible (${msg.slice(0, 120)}).`;
}

// Test minimal d'une clé avant de l'enregistrer (route /api/account/api-keys).
export async function testByokKey(
  provider: BYOKProviderId,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await callByokJson({ provider, apiKey }, [{ role: "user", content: 'Réponds juste "ok".' }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}
```

Now update `LLMProvider` (defined earlier in the file) and the three public functions. Change:

```typescript
export type LLMProvider = "local" | "cloud";
```

to:

```typescript
export type LLMProvider = "local" | "cloud" | "byok";
```

Update `CallOptions` to add the new field:

```typescript
export interface CallOptions {
  jsonMode?: boolean;
  useArtifactModel?: boolean;
  forceProvider?: "local" | "cloud";
  byok?: BYOKConfig | null;
}
```

Update `callChatModel` — insert the BYOK attempt as the first tier, before the existing `forceProvider === "cloud"` check:

```typescript
export async function callChatModel(
  messages: LLMMessage[],
  opts?: CallOptions,
): Promise<LLMResult<string>> {
  if (opts?.byok && opts.forceProvider !== "local") {
    try {
      const data = await callByokJson(opts.byok, messages, opts);
      return { provider: "byok", providerLabel: byokProviderLabel(opts.byok), data };
    } catch (e) {
      console.error("BYOK indisponible, repli local/cloud :", describeByokError(opts.byok, e));
    }
  }
  if (opts?.forceProvider === "cloud") {
    const data = await callMistralJson(messages, opts);
    return { provider: "cloud", providerLabel: cloudLabel(opts), data };
  }
  try {
    const data = await callOllamaJson(messages, opts);
    return { provider: "local", providerLabel: localLabel(opts), data };
  } catch (e) {
    if (!isOllamaUnavailable(e)) throw e;
    if (opts?.forceProvider === "local") throw new Error("OLLAMA_LOCAL_FORCED_UNAVAILABLE");
    const data = await callMistralJson(messages, opts);
    return { provider: "cloud", providerLabel: cloudLabel(opts), data };
  }
}
```

Update `callChatModelStream` the same way (its `opts` type widens to include `byok`):

```typescript
export async function callChatModelStream(
  messages: LLMMessage[],
  opts?: Pick<CallOptions, "forceProvider"> & { byok?: BYOKConfig | null },
): Promise<LLMResult<AsyncIterable<string>>> {
  if (opts?.byok && opts.forceProvider !== "local") {
    try {
      const data = await callByokStream(opts.byok, messages);
      return { provider: "byok", providerLabel: byokProviderLabel(opts.byok), data };
    } catch (e) {
      console.error("BYOK indisponible, repli local/cloud :", describeByokError(opts.byok, e));
    }
  }
  if (opts?.forceProvider === "cloud") {
    const data = await callMistralStream(messages);
    return { provider: "cloud", providerLabel: cloudLabel(), data };
  }
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: true, think: false, messages }),
    });
    if (res.status === 404) throw new Error("OLLAMA_404 model not found");
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
    }
    return {
      provider: "local",
      providerLabel: localLabel(),
      data: ollamaStreamToText(res.body),
    };
  } catch (e) {
    if (!isOllamaUnavailable(e)) throw e;
    if (opts?.forceProvider === "local") throw new Error("OLLAMA_LOCAL_FORCED_UNAVAILABLE");
    const data = await callMistralStream(messages);
    return { provider: "cloud", providerLabel: cloudLabel(), data };
  }
}
```

Update `callModelWithTools` the same way:

```typescript
export async function callModelWithTools(
  messages: ToolLoopMessage[],
  tools: ToolDef[],
  opts?: { forceProvider?: LLMProvider; byok?: BYOKConfig | null },
): Promise<LLMResult<ToolTurnResult>> {
  if (opts?.byok && opts.forceProvider !== "local") {
    try {
      const data = await callByokTools(opts.byok, messages, tools);
      return { provider: "byok", providerLabel: byokProviderLabel(opts.byok), data };
    } catch (e) {
      console.error("BYOK (tools) indisponible, repli local/cloud :", describeByokError(opts.byok, e));
    }
  }
  if (opts?.forceProvider === "cloud") {
    const data = await callMistralTools(messages, tools);
    return { provider: "cloud", providerLabel: modelLabel(MISTRAL_MODEL, "cloud"), data };
  }
  try {
    const data = await callOllamaTools(messages, tools);
    return { provider: "local", providerLabel: modelLabel(OLLAMA_TOOL_MODEL, "local"), data };
  } catch (e) {
    if (opts?.forceProvider === "local") throw e;
    const data = await callMistralTools(messages, tools);
    return { provider: "cloud", providerLabel: modelLabel(MISTRAL_MODEL, "cloud"), data };
  }
}
```

Finally, remove the three test-only aliases added in Tasks 3-5 (`callAnthropicJsonForTest`, `callOpenAICompatibleJsonForTest`, `callGoogleJsonForTest`) and update `lib/llm.test.ts`'s imports to pull the real names — they're now reachable indirectly through `callChatModel`/`testByokKey`, but keep direct unit tests on the adapters too by exporting them permanently instead of removing:

```typescript
// Exports internes réservés aux tests (lib/llm.test.ts) — pas utilisés par le
// reste de l'app, qui passe toujours par callChatModel/Stream ou callModelWithTools.
export {
  callAnthropicJson as __callAnthropicJsonForTest,
  callOpenAICompatibleJson as __callOpenAICompatibleJsonForTest,
  callGoogleJson as __callGoogleJsonForTest,
};
```

Update the three earlier test imports in `lib/llm.test.ts` to use these final names (`__callAnthropicJsonForTest`, `__callOpenAICompatibleJsonForTest`, `__callGoogleJsonForTest`) instead of the per-task temporary ones, and delete the now-redundant `export { ... as ...ForTest }` lines added in Tasks 3-5.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/llm.test.ts`
Expected: PASS (all tests, ~12 total)

- [ ] **Step 5: Run full lib test suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green — confirms the `LLMProvider`/`CallOptions` widening didn't break `lib/web-search.ts` or `lib/artifacts.ts` call sites (those still pass `forceProvider` only, which remains valid).

- [ ] **Step 6: Commit**

```bash
git add lib/llm.ts lib/llm.test.ts
git commit -m "feat: intègre le repli BYOK -> local -> cloud dans lib/llm.ts"
```

---

## Task 7: `lib/models.ts` — pretty names + privacy note for BYOK

**Files:**
- Modify: `lib/models.ts`
- Test: `lib/models.test.ts` (new)

**Interfaces:**
- Produces: extended `ModelProvider = "local" | "cloud" | "byok"`, `providerPrivacyNote` accepting `"byok"`, new `PRETTY_RULES` entries for `claude`, `gpt`, `gemini`, and extended `ModelStatus` interface with an optional `byok` field: `byok: { configured: boolean; provider: BYOKProviderId | null; label: string | null; chatModel: string | null } | null`.
- Consumes: nothing new — pure additions to existing exports.

- [ ] **Step 1: Write the failing test**

Create `lib/models.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { prettyModelName, providerPrivacyNote } from "./models";

describe("prettyModelName — nouvelles familles BYOK", () => {
  it("reconnaît Claude", () => {
    expect(prettyModelName("claude-sonnet-4-6")).toBe("Claude Sonnet");
  });
  it("reconnaît GPT", () => {
    expect(prettyModelName("gpt-4o-mini")).toBe("GPT-4o mini");
  });
  it("reconnaît Gemini", () => {
    expect(prettyModelName("gemini-2.0-flash")).toBe("Gemini Flash");
  });
});

describe("providerPrivacyNote('byok')", () => {
  it("mentionne que c'est la clé de l'utilisateur, facturée par le fournisseur", () => {
    const note = providerPrivacyNote("byok");
    expect(note).toMatch(/votre clé/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/models.test.ts`
Expected: FAIL — `prettyModelName("claude-...")` returns `"Claude-sonnet-4-5-20250929"` (fallback capitalisation) instead of `"Claude Sonnet"`; `providerPrivacyNote("byok")` is a type error (not yet accepted).

- [ ] **Step 3: Implement the additions**

In `lib/models.ts`, change:

```typescript
export type ModelProvider = "local" | "cloud";
```

to:

```typescript
export type ModelProvider = "local" | "cloud" | "byok";
```

Add to `PRETTY_RULES` (most-specific-first, same convention as existing entries — insert near the top since `claude`/`gpt`/`gemini` don't collide with any existing prefix):

```typescript
  { prefix: "claude-sonnet", name: "Claude Sonnet", family: "Claude" },
  { prefix: "claude-opus", name: "Claude Opus", family: "Claude" },
  { prefix: "claude-haiku", name: "Claude Haiku", family: "Claude" },
  { prefix: "claude", name: "Claude", family: "Claude" },
  { prefix: "gpt-4o-mini", name: "GPT-4o mini", family: "GPT" },
  { prefix: "gpt-4o", name: "GPT-4o", family: "GPT" },
  { prefix: "gpt", name: "GPT", family: "GPT" },
  { prefix: "gemini-2.0-flash", name: "Gemini Flash", family: "Gemini" },
  { prefix: "gemini", name: "Gemini", family: "Gemini" },
```

Update `providerPrivacyNote`:

```typescript
export function providerPrivacyNote(provider: ModelProvider): string {
  if (provider === "byok") {
    return "Appel direct à l'API du fournisseur avec votre clé personnelle — facturé par lui, pas par Fondio.";
  }
  return provider === "local"
    ? "Tourne sur notre serveur via Ollama. Vos données ne quittent pas nos machines."
    : "Appel à l'API Mistral (serveurs en Europe). Utilisé en secours quand le modèle local est indisponible.";
}
```

Extend `ModelStatus`:

```typescript
export interface ModelStatus {
  available: boolean;
  local: { chat: string; artifact: string; tool: string };
  cloud: { chat: string; artifact: string; configured: boolean };
  byok: {
    configured: boolean;
    provider: "anthropic" | "openai" | "google" | "mistral_byok" | null;
    label: string | null;
    chatModel: string | null;
  } | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/models.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: green (confirms `ModelStatus`'s new required `byok` field doesn't yet break callers — Task 10 will populate it; if typecheck fails because `/api/ollama-status` constructs a `ModelStatus` without `byok`, make `byok` optional (`byok?: ...`) instead of required, to keep this task self-contained.)

- [ ] **Step 6: Commit**

```bash
git add lib/models.ts lib/models.test.ts
git commit -m "feat: ajoute les familles Claude/GPT/Gemini et la note de confidentialité BYOK"
```

---

## Task 8: `lib/byok.ts` — provider registry + load user config

**Files:**
- Create: `lib/byok.ts`
- Test: `lib/byok.test.ts`

**Interfaces:**
- Produces: `export const BYOK_PROVIDER_IDS: BYOKProviderId[]` (the 4 ids, in UI display order), `export async function loadUserByokConfig(supabase: SupabaseLike, userId: string): Promise<BYOKConfig | null>`, `export interface SupabaseLike` (minimal shape needed, so tests can mock without pulling in real Supabase types).
- Consumes: `BYOKProviderId`, `BYOKConfig` from `lib/llm.ts` (Task 3); `decryptSecret` from `lib/crypto.ts` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `lib/byok.test.ts`:

```typescript
import { beforeAll, describe, expect, it } from "vitest";
import { loadUserByokConfig } from "./byok";
import { encryptSecret } from "./crypto";

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

function fakeSupabase(profileRow: unknown, keyRow: unknown) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { single: async () => ({ data: keyRow }) };
                },
                single: async () => ({ data: table === "profiles" ? profileRow : keyRow }),
              };
            },
          };
        },
      };
    },
  };
}

describe("loadUserByokConfig", () => {
  it("returns null when the user has no preferred provider", async () => {
    const supabase = fakeSupabase({ preferred_ai_provider: null }, null);
    const result = await loadUserByokConfig(supabase, "user-1");
    expect(result).toBeNull();
  });

  it("returns the decrypted key when a preference and a matching key exist", async () => {
    const encrypted = encryptSecret("sk-ant-real-key");
    const supabase = fakeSupabase(
      { preferred_ai_provider: "anthropic" },
      { encrypted_key: encrypted },
    );
    const result = await loadUserByokConfig(supabase, "user-1");
    expect(result).toEqual({ provider: "anthropic", apiKey: "sk-ant-real-key" });
  });

  it("returns null when the preference is set but no key row exists", async () => {
    const supabase = fakeSupabase({ preferred_ai_provider: "anthropic" }, null);
    const result = await loadUserByokConfig(supabase, "user-1");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/byok.test.ts`
Expected: FAIL — `Cannot find module './byok'`

- [ ] **Step 3: Implement `lib/byok.ts`**

```typescript
// Charge la préférence BYOK de l'utilisateur (profiles.preferred_ai_provider)
// et la clé correspondante (user_api_keys), déchiffrée. Centralise cette
// lecture pour que app/api/chat, lib/web-search et lib/artifacts l'utilisent
// tous de la même façon.
import { decryptSecret } from "./crypto";
import type { BYOKConfig, BYOKProviderId } from "./llm";

export const BYOK_PROVIDER_IDS: BYOKProviderId[] = ["anthropic", "openai", "google", "mistral_byok"];

// Sous-ensemble minimal de l'API Supabase utilisé ici — permet de mocker
// facilement dans les tests sans dépendre du vrai client typé.
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq?(column: string, value: string): { single(): Promise<{ data: unknown }> };
        single(): Promise<{ data: unknown }>;
      };
    };
  };
}

export async function loadUserByokConfig(
  supabase: SupabaseLike,
  userId: string,
): Promise<BYOKConfig | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("preferred_ai_provider")
    .eq("user_id", userId)
    .single();

  const provider = (profile as { preferred_ai_provider?: BYOKProviderId | null } | null)
    ?.preferred_ai_provider;
  if (!provider) return null;

  const keyQuery = supabase.from("user_api_keys").select("encrypted_key").eq("user_id", userId);
  const { data: row } = await (keyQuery.eq?.("provider", provider) ?? keyQuery).single();

  const encryptedKey = (row as { encrypted_key?: string } | null)?.encrypted_key;
  if (!encryptedKey) return null;

  try {
    return { provider, apiKey: decryptSecret(encryptedKey) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/byok.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/byok.ts lib/byok.test.ts
git commit -m "feat: ajoute lib/byok.ts (chargement de la préférence + clé déchiffrée)"
```

---

## Task 9: `app/api/account/api-keys/route.ts` — save/validate/delete keys + set preference

**Files:**
- Create: `app/api/account/api-keys/route.ts`

**Interfaces:**
- Produces: `POST` (body `{ provider: BYOKProviderId; apiKey: string }` → validates via `testByokKey`, encrypts via `encryptSecret`, upserts into `user_api_keys`), `DELETE` (body `{ provider: BYOKProviderId }` → removes the row, and clears `profiles.preferred_ai_provider` if it pointed to that provider), `PUT` (body `{ preferredProvider: BYOKProviderId | null }` → updates `profiles.preferred_ai_provider`, only allowed if a key already exists for that provider or the value is `null`).
- Consumes: `testByokKey`, `BYOKProviderId` from `lib/llm.ts`; `encryptSecret` from `lib/crypto.ts`; `createClient` from `lib/supabase/server.ts`; `BYOK_PROVIDER_IDS` from `lib/byok.ts`.

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { BYOK_PROVIDER_IDS } from "@/lib/byok";
import { encryptSecret } from "@/lib/crypto";
import { testByokKey, type BYOKProviderId } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isValidProvider(p: unknown): p is BYOKProviderId {
  return typeof p === "string" && (BYOK_PROVIDER_IDS as string[]).includes(p);
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await req.json()) as { provider?: unknown; apiKey?: unknown };
  if (!isValidProvider(body.provider) || typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    return NextResponse.json({ error: "provider et apiKey requis." }, { status: 400 });
  }

  const test = await testByokKey(body.provider, body.apiKey.trim());
  if (!test.ok) {
    return NextResponse.json({ error: `Clé invalide : ${test.error}` }, { status: 400 });
  }

  const encrypted_key = encryptSecret(body.apiKey.trim());
  const { error } = await supabase
    .from("user_api_keys")
    .upsert(
      { user_id: user.id, provider: body.provider, encrypted_key, updated_at: new Date().toISOString() },
      { onConflict: "user_id,provider" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await req.json()) as { provider?: unknown };
  if (!isValidProvider(body.provider)) {
    return NextResponse.json({ error: "provider requis." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", body.provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Si c'était le fournisseur préféré, on retombe sur Local/Mistral Fondio.
  const { data: profile } = await supabase
    .from("profiles")
    .select("preferred_ai_provider")
    .eq("user_id", user.id)
    .single();
  if (profile?.preferred_ai_provider === body.provider) {
    await supabase.from("profiles").update({ preferred_ai_provider: null }).eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await req.json()) as { preferredProvider?: unknown };
  const preferredProvider = body.preferredProvider;
  if (preferredProvider !== null && !isValidProvider(preferredProvider)) {
    return NextResponse.json({ error: "preferredProvider invalide." }, { status: 400 });
  }

  if (preferredProvider !== null) {
    const { data: keyRow } = await supabase
      .from("user_api_keys")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", preferredProvider)
      .single();
    if (!keyRow) {
      return NextResponse.json(
        { error: "Aucune clé enregistrée pour ce fournisseur — ajoutez-la d'abord." },
        { status: 400 },
      );
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_ai_provider: preferredProvider })
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Manual verification (no automated route test in this codebase — `app/api/*` routes aren't unit-tested elsewhere either)**

Start the dev server (`npm run dev`), log in, then from the browser console (already authenticated, cookies sent automatically) or via `curl` with a copied session cookie:

```bash
curl -s -X POST http://localhost:3000/api/account/api-keys \
  -H "Content-Type: application/json" -H "Cookie: <copier depuis devtools>" \
  -d '{"provider":"anthropic","apiKey":"sk-ant-invalid-test"}'
# Attendu : {"error":"Clé invalide : Anthropic 401: ..."} avec status 400
```

With a real, valid key instead of `sk-ant-invalid-test`, expect `{"ok":true}` with status 200, and a new row in `user_api_keys` (encrypted) visible in the Supabase table editor.

- [ ] **Step 3: Commit**

```bash
git add app/api/account/api-keys/route.ts
git commit -m "feat: ajoute la route API pour enregistrer/valider/supprimer les clés BYOK"
```

---

## Task 10: `app/api/ollama-status/route.ts` — expose per-user BYOK status

**Files:**
- Modify: `app/api/ollama-status/route.ts`

**Interfaces:**
- Produces: the `GET` response now includes `byok` (shape from Task 7's extended `ModelStatus`), populated from the authenticated user's `profiles.preferred_ai_provider` + presence of a matching `user_api_keys` row (key existence only — never decrypted here, since this route only reports status, never calls the provider).
- Consumes: `createClient` from `lib/supabase/server.ts`; `byokDisplayLabel` and `BYOK_MODELS`-equivalent info — since `BYOK_MODELS` is module-private in `lib/llm.ts`, also export a small lookup `BYOK_CHAT_MODELS: Record<BYOKProviderId, string>` from `lib/llm.ts` in this task (a 4-line addition).

- [ ] **Step 1: Export the chat-model lookup from `lib/llm.ts`**

In `lib/llm.ts`, right after the `BYOK_MODELS` constant (added in Task 6), add:

```typescript
// Lecture seule pour /api/ollama-status — pas besoin d'exposer l'objet complet
// (qui contient aussi le modèle "artifact", non pertinent pour l'UI de statut).
export const BYOK_CHAT_MODELS: Record<BYOKProviderId, string> = Object.fromEntries(
  Object.entries(BYOK_MODELS).map(([k, v]) => [k, v.chat]),
) as Record<BYOKProviderId, string>;
```

- [ ] **Step 2: Update the route**

Replace the full contents of `app/api/ollama-status/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { BYOK_CHAT_MODELS, MODELS, byokDisplayLabel, type BYOKProviderId } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import type { ModelStatus } from "@/lib/models";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const runtime = "nodejs";

// Renvoie l'état d'Ollama, la config réelle des modèles, ET (si l'utilisateur
// est authentifié) son statut BYOK — pour que ModelSelector affiche le bon
// fournisseur sans appel séparé.
export async function GET() {
  let available = false;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    available = res.ok;
  } catch {
    available = false;
  }

  let byok: ModelStatus["byok"] = null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("preferred_ai_provider")
      .eq("user_id", user.id)
      .single();
    const provider = profile?.preferred_ai_provider as BYOKProviderId | null;
    if (provider) {
      const { data: keyRow } = await supabase
        .from("user_api_keys")
        .select("id")
        .eq("user_id", user.id)
        .eq("provider", provider)
        .single();
      byok = {
        configured: Boolean(keyRow),
        provider,
        label: byokDisplayLabel(provider),
        chatModel: BYOK_CHAT_MODELS[provider],
      };
    }
  }

  const body: ModelStatus = {
    available,
    local: MODELS.local,
    cloud: MODELS.cloud,
    byok,
  };
  return NextResponse.json(body);
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms `ModelStatus.byok` from Task 7 matches this shape exactly).

- [ ] **Step 4: Manual verification**

`npm run dev`, log in, visit `http://localhost:3000/api/ollama-status` directly (or check the network tab) — expect `byok: null` (no preference set yet, since Task 9's route hasn't been used through the UI). After Task 13 lets you set a preference through the UI, re-check this endpoint to confirm `byok.configured` becomes `true`.

- [ ] **Step 5: Commit**

```bash
git add lib/llm.ts app/api/ollama-status/route.ts
git commit -m "feat: expose le statut BYOK dans /api/ollama-status"
```

---

## Task 11: `app/api/chat/route.ts` — load and use the BYOK config

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `loadUserByokConfig` from `lib/byok.ts` (Task 8); passes the result as `byok` to `callChatModelStream` (Task 6) and `generateArtifacts` (Task 12) and `gatherWebContext` (Task 12).

- [ ] **Step 1: Load the BYOK config right after auth, skip it when the user explicitly chose "local"**

In `app/api/chat/route.ts`, add the import:

```typescript
import { loadUserByokConfig } from "@/lib/byok";
```

After the `if (!user) return ...` auth check (right before the session lookup), add:

```typescript
  // BYOK seulement si l'utilisateur n'a pas explicitement choisi "local" pour
  // cette session — cohérent avec la résolution dans lib/llm.ts.
  const byok = preferredProvider === "local" ? null : await loadUserByokConfig(supabase, user.id);
```

- [ ] **Step 2: Pass it to the three call sites**

Change:

```typescript
    streamResult = await callChatModelStream(llmMessages, { forceProvider: preferredProvider });
```

to:

```typescript
    streamResult = await callChatModelStream(llmMessages, { forceProvider: preferredProvider, byok });
```

Change the web search call:

```typescript
    const research = await gatherWebContext(updatedHistory, preferredProvider);
```

to:

```typescript
    const research = await gatherWebContext(updatedHistory, preferredProvider, byok);
```

(Task 12 below updates `gatherWebContext`'s signature to accept this 3rd param.)

Change the artifact generation call:

```typescript
        const artifacts = await generateArtifacts({
          conversation: updatedHistory,
          assistantReply: parsed.content,
          deliverableTitles: parsed.deliverables,
          forceProvider: preferredProvider,
        });
```

to:

```typescript
        const artifacts = await generateArtifacts({
          conversation: updatedHistory,
          assistantReply: parsed.content,
          deliverableTitles: parsed.deliverables,
          forceProvider: preferredProvider,
          byok,
        });
```

- [ ] **Step 3: Run typecheck (expect failures pointing at Task 12's files — that's expected until Task 12 lands)**

Run: `npm run typecheck`
Expected: errors in `lib/web-search.ts` and `lib/artifacts.ts` ("Expected 2 arguments, but got 3" / unknown property `byok`) — confirms the call sites are correctly updated; Task 12 fixes the callees.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: branche le chargement BYOK dans /api/chat"
```

---

## Task 12: `lib/web-search.ts` + `lib/artifacts.ts` — thread the BYOK config through

**Files:**
- Modify: `lib/web-search.ts`
- Modify: `lib/artifacts.ts`

**Interfaces:**
- Produces: `gatherWebContext(conversation: ChatMessage[], preferredProvider?: "local" | "cloud", byok?: BYOKConfig | null): Promise<WebContext>`; `generateArtifacts(args: { ...; byok?: BYOKConfig | null })`.
- Consumes: `BYOKConfig` type from `lib/llm.ts`.

- [ ] **Step 1: Update `lib/artifacts.ts`**

Add `BYOKConfig` to the import from `./llm`:

```typescript
import { callChatModel, type BYOKConfig } from "./llm";
```

Update the function signature and the call to `callChatModel`:

```typescript
export async function generateArtifacts(args: {
  conversation: ChatMessage[];
  assistantReply: string;
  deliverableTitles: string[];
  forceProvider?: "local" | "cloud";
  byok?: BYOKConfig | null;
}): Promise<Artifact[]> {
  const { conversation, assistantReply, deliverableTitles, forceProvider, byok } = args;
```

(further down, where `callChatModel` is invoked):

```typescript
    const { data: raw } = await callChatModel(
      [
        { role: "system", content: ARTIFACTS_FORMAT_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { jsonMode: true, useArtifactModel: true, forceProvider, byok },
    );
```

- [ ] **Step 2: Update `lib/web-search.ts`**

Add `BYOKConfig` to the import from `./llm`:

```typescript
import {
  callChatModel,
  callModelWithTools,
  type BYOKConfig,
  type ToolDef,
  type ToolLoopMessage,
} from "./llm";
```

Update `gatherWebContext` and the two internal functions it calls (`runWebResearch`, `decideSearchQuery`) to accept and forward `byok`:

```typescript
export async function gatherWebContext(
  conversation: ChatMessage[],
  preferredProvider?: "local" | "cloud",
  byok?: BYOKConfig | null,
): Promise<WebContext> {
  try {
    const research = await runWebResearch(conversation, preferredProvider, byok);
    if (research.sources.length > 0) return research;
  } catch (e) {
    console.error("Tool-calling indisponible :", e);
  }

  try {
    const query = await decideSearchQuery(conversation, preferredProvider, byok);
    if (query) {
      const search = await searchWeb(query);
      return {
        webContext: formatWebResultsForPrompt(search),
        sources: search.results.map((r) => ({ title: r.title, url: r.url })),
      };
    }
  } catch (e) {
    console.error("Recherche web ignorée :", e);
  }

  return EMPTY_WEB_CONTEXT;
}
```

Find `runWebResearch`'s definition (`async function runWebResearch(conversation: ChatMessage[], preferredProvider?: "local" | "cloud")`) and:
1. Add the `byok?: BYOKConfig | null` parameter to its signature.
2. Find its call to `callModelWithTools(messages, [WEB_SEARCH_TOOL], { ... })` and add `byok` to that options object.

Find `decideSearchQuery`'s definition and:
1. Add the `byok?: BYOKConfig | null` parameter to its signature.
2. Find its call to `callChatModel(...)` and add `byok` to its options object.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors — this resolves the Task 11 failures.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all green (no existing test exercises `gatherWebContext`/`generateArtifacts` directly, so this is a regression check on everything else).

- [ ] **Step 5: Commit**

```bash
git add lib/web-search.ts lib/artifacts.ts
git commit -m "feat: propage la config BYOK à la recherche web et la génération d'artefacts"
```

---

## Task 13: `components/AccountScreen.tsx` — "Votre IA personnelle" section

**Files:**
- Modify: `components/AccountScreen.tsx`

**Interfaces:**
- Produces: a new `SectionCard` block rendered in the existing grid, calling `POST/DELETE /api/account/api-keys` (Task 9) and `PUT /api/account/api-keys` for the preference. No new exported interfaces — this is a leaf UI change.
- Consumes: existing `Field`, `SectionCard`, `SubSection`, `primaryBtn`, `C` (design tokens), `Icon`, `useIsMobile` already in this file.

- [ ] **Step 1: Add the provider metadata + local state**

Near the top of `components/AccountScreen.tsx` (after the existing imports), add:

```typescript
const BYOK_PROVIDERS: { id: "anthropic" | "openai" | "google" | "mistral_byok"; label: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI (GPT)", placeholder: "sk-..." },
  { id: "google", label: "Google (Gemini)", placeholder: "AIza..." },
  { id: "mistral_byok", label: "Mistral", placeholder: "..." },
];

interface ByokKeyState {
  configured: boolean;
  inputValue: string;
  saving: boolean;
  msg: { type: "ok" | "err"; text: string } | null;
}
```

Inside the `AccountScreen` component function, after the existing `useState` declarations, add:

```typescript
  const [byokKeys, setByokKeys] = useState<Record<string, ByokKeyState>>(() =>
    Object.fromEntries(
      BYOK_PROVIDERS.map((p) => [p.id, { configured: false, inputValue: "", saving: false, msg: null }]),
    ),
  );
  const [preferredProvider, setPreferredProvider] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);
```

- [ ] **Step 2: Load existing status on mount**

The existing `useEffect` block loads `email`/`fullName` from `profiles`. Extend that same query's `select` to also fetch `preferred_ai_provider`, and add a 2nd query for which providers already have a key configured (existence only, never the key itself):

Change:

```typescript
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("user_id", user.id).single();
      setFullName(profile?.full_name ?? "");
      setLoadingProfile(false);
```

to:

```typescript
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, preferred_ai_provider")
        .eq("user_id", user.id)
        .single();
      setFullName(profile?.full_name ?? "");
      setPreferredProvider(profile?.preferred_ai_provider ?? null);

      const { data: keyRows } = await supabase.from("user_api_keys").select("provider").eq("user_id", user.id);
      const configuredSet = new Set((keyRows ?? []).map((r) => r.provider as string));
      setByokKeys((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          next[id] = { ...next[id], configured: configuredSet.has(id) };
        }
        return next;
      });

      setLoadingProfile(false);
```

- [ ] **Step 3: Add the save/delete/preference handlers**

After the existing `savePassword` callback, add:

```typescript
  const saveByokKey = useCallback(async (providerId: string) => {
    const value = byokKeys[providerId]?.inputValue.trim();
    if (!value) return;
    setByokKeys((prev) => ({ ...prev, [providerId]: { ...prev[providerId], saving: true, msg: null } }));
    try {
      const res = await fetch("/api/account/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey: value }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setByokKeys((prev) => ({
          ...prev,
          [providerId]: { ...prev[providerId], saving: false, msg: { type: "err", text: json.error ?? "Erreur." } },
        }));
        return;
      }
      setByokKeys((prev) => ({
        ...prev,
        [providerId]: { configured: true, inputValue: "", saving: false, msg: { type: "ok", text: "Clé enregistrée." } },
      }));
    } catch {
      setByokKeys((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], saving: false, msg: { type: "err", text: "Erreur réseau." } },
      }));
    }
  }, [byokKeys]);

  const deleteByokKey = useCallback(async (providerId: string) => {
    setByokKeys((prev) => ({ ...prev, [providerId]: { ...prev[providerId], saving: true, msg: null } }));
    try {
      await fetch("/api/account/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      setByokKeys((prev) => ({
        ...prev,
        [providerId]: { configured: false, inputValue: "", saving: false, msg: { type: "ok", text: "Clé supprimée." } },
      }));
      setPreferredProvider((prev) => (prev === providerId ? null : prev));
    } catch {
      setByokKeys((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], saving: false, msg: { type: "err", text: "Erreur réseau." } },
      }));
    }
  }, []);

  const updatePreferredProvider = useCallback(async (providerId: string | null) => {
    setSavingPreference(true);
    try {
      const res = await fetch("/api/account/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredProvider: providerId }),
      });
      if (res.ok) setPreferredProvider(providerId);
    } finally {
      setSavingPreference(false);
    }
  }, []);
```

- [ ] **Step 4: Render the section**

Inside the grid `<div style={{ display: "grid", ... }}>`, after the closing `</SectionCard>` of "Mot de passe", add a 3rd card:

```tsx
              <SectionCard title="Votre IA personnelle">
                <div style={{ fontSize: 12, color: C.textSub, marginBottom: 16, lineHeight: 1.5 }}>
                  Connectez votre propre clé API pour utiliser votre fournisseur préféré dans toutes vos
                  conversations. Facturé directement par le fournisseur, pas par Fondio. En cas de panne ou de
                  clé invalide, Fondio bascule automatiquement sur le modèle local ou Mistral.
                </div>
                {BYOK_PROVIDERS.map((p, i) => {
                  const state = byokKeys[p.id];
                  return (
                    <SubSection key={p.id} last={i === BYOK_PROVIDERS.length - 1}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{p.label}</span>
                        {state.configured && (
                          <span style={{ fontSize: 11, color: C.mint, fontWeight: 700 }}>· configurée</span>
                        )}
                        <label style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto", fontSize: 11.5, color: C.textSub, cursor: state.configured ? "pointer" : "default" }}>
                          <input
                            type="radio"
                            name="preferredProvider"
                            disabled={!state.configured || savingPreference}
                            checked={preferredProvider === p.id}
                            onChange={() => updatePreferredProvider(p.id)}
                          />
                          Utiliser par défaut
                        </label>
                      </div>
                      {state.configured ? (
                        <button
                          onClick={() => deleteByokKey(p.id)}
                          disabled={state.saving}
                          style={{ ...primaryBtn(state.saving), background: C.bg, color: C.pink, border: `1px solid ${C.border}` }}
                        >
                          {state.saving && <LuLoader size={14} style={{ animation: "fndSpin 0.7s linear infinite" }} />}
                          Supprimer la clé
                        </button>
                      ) : (
                        <>
                          <Field
                            label=""
                            type="password"
                            value={state.inputValue}
                            onChange={(v) =>
                              setByokKeys((prev) => ({ ...prev, [p.id]: { ...prev[p.id], inputValue: v } }))
                            }
                            placeholder={p.placeholder}
                          />
                          <button onClick={() => saveByokKey(p.id)} disabled={state.saving} style={primaryBtn(state.saving)}>
                            {state.saving && <LuLoader size={14} style={{ animation: "fndSpin 0.7s linear infinite" }} />}
                            Valider et enregistrer
                          </button>
                        </>
                      )}
                      <Msg msg={state.msg} />
                    </SubSection>
                  );
                })}
                {preferredProvider && (
                  <button
                    onClick={() => updatePreferredProvider(null)}
                    disabled={savingPreference}
                    style={{ fontSize: 11.5, color: C.textSub, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 4 }}
                  >
                    Revenir à Local / Mistral Fondio
                  </button>
                )}
              </SectionCard>
```

Change the grid's `gridTemplateColumns` from `isMobile ? "1fr" : "1fr 1fr"` to `isMobile ? "1fr" : "1fr 1fr 1fr"` so the 3rd card fits alongside the other two without forcing an awkward wrap — or leave it `1fr 1fr` and let the 3rd card wrap to a new row (simpler, no layout risk): **use this simpler option**, no grid change needed.

- [ ] **Step 5: Manual UI verification (no automated test for this file — no existing component test infra in the repo)**

`npm run dev`, log in, navigate to "Mon compte", and verify:
1. The "Votre IA personnelle" card renders with 4 provider rows, each with a password field + "Valider et enregistrer".
2. Entering an invalid key shows an inline red error and does NOT mark it as configured.
3. Entering a valid key (use a real key if you have one, or skip this sub-step if not) marks it "· configurée", replaces the field with a "Supprimer la clé" button, and enables the "Utiliser par défaut" radio.
4. Selecting "Utiliser par défaut" persists across a page reload (re-fetch `/api/ollama-status` should now show `byok.configured: true`).
5. Clicking "Supprimer la clé" removes the row and, if it was the preferred provider, resets the preference.

- [ ] **Step 6: Commit**

```bash
git add components/AccountScreen.tsx
git commit -m "feat: ajoute la gestion des clés API BYOK dans Mon compte"
```

---

## Task 14: `components/ModelSelector.tsx` — dynamic "Cloud" label

**Files:**
- Modify: `components/ModelSelector.tsx`

**Interfaces:**
- Consumes: `ModelStatus.byok` (Task 7/10). No prop signature changes — `ModelSelector` already receives the full `status: ModelStatus | null`.

- [ ] **Step 1: Compute the dynamic cloud display values**

In `components/ModelSelector.tsx`, inside the `ModelSelector` function, after the existing:

```typescript
  const ollamaUp = status?.available ?? false;
  const cloudReady = status?.cloud.configured ?? false;
```

add:

```typescript
  const byok = status?.byok ?? null;
  const byokActive = Boolean(byok?.configured);
  const cloudTitle = byokActive ? `${byok!.label} · votre clé` : "Mistral Cloud";
  const cloudChatModelName = byokActive ? byok!.label! : status ? prettyModelName(status.cloud.chat) : "—";
  const cloudPrivacyNote = providerPrivacyNote(byokActive ? "byok" : "cloud");
  const cloudStatusNote = byokActive
    ? "Votre clé personnelle · secours auto si indisponible"
    : cloudReady
      ? "Secours · API Europe"
      : "Clé API non configurée";
```

- [ ] **Step 2: Use these in the button label and the `ProviderOption`**

Change the line:

```typescript
  const activeModelId = isLocal ? status?.local.chat : status?.cloud.chat;
  const activeName = activeModelId ? prettyModelName(activeModelId) : isLocal ? "Local" : "Cloud";
```

to:

```typescript
  const activeName = isLocal
    ? status?.local.chat
      ? prettyModelName(status.local.chat)
      : "Local"
    : cloudChatModelName;
```

Change the 2nd `ProviderOption` block (currently titled `"Mistral Cloud"`):

```tsx
          <ProviderOption
            color={CLOUD_COLOR}
            icon="globe"
            title="Mistral Cloud"
            active={!isLocal}
            disabled={!cloudReady}
            statusNote={cloudReady ? "Secours · API Europe" : "Clé API non configurée"}
            statusOk={cloudReady}
            modelName={status ? prettyModelName(status.cloud.chat) : "—"}
            roles={status ? [["Livrables", prettyModelName(status.cloud.artifact)]] : []}
            privacyNote={providerPrivacyNote("cloud")}
            onClick={() => cloudReady && pick("cloud")}
          />
```

to:

```tsx
          <ProviderOption
            color={CLOUD_COLOR}
            icon="globe"
            title={cloudTitle}
            active={!isLocal}
            disabled={!cloudReady && !byokActive}
            statusNote={cloudStatusNote}
            statusOk={cloudReady || byokActive}
            modelName={cloudChatModelName}
            roles={
              byokActive
                ? []
                : status
                  ? [["Livrables", prettyModelName(status.cloud.artifact)]]
                  : []
            }
            privacyNote={cloudPrivacyNote}
            onClick={() => (cloudReady || byokActive) && pick("cloud")}
          />
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual UI verification**

With a BYOK preference set (from Task 13's verification), reload a chat session: the model badge near the chat input should now read the BYOK provider's label instead of "Mistral Cloud" / "Mistral Small", and the popover's 2nd option should show the same, with the BYOK-specific privacy note. With no preference set, confirm behavior is byte-for-byte the same as before this change (Mistral Cloud, unchanged).

- [ ] **Step 5: Commit**

```bash
git add components/ModelSelector.tsx
git commit -m "feat: ModelSelector reflète dynamiquement le fournisseur BYOK actif"
```

---

## Task 15: End-to-end manual verification + fallback check

**Files:** none (verification only)

- [ ] **Step 1: Full automated check**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 2: Apply the migration to your working Supabase project (if not already done in Task 1)**

Confirm `user_api_keys` exists and `profiles.preferred_ai_provider` is present (same queries as Task 1, Step 2).

- [ ] **Step 3: Set the encryption secret locally**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the output to `.env.local` as `API_KEY_ENCRYPTION_SECRET=...`. Restart `npm run dev`.

- [ ] **Step 4: Happy path**

1. Log in, go to "Mon compte", add a real Anthropic (or any provider you have a key for) API key. Expect "Clé enregistrée."
2. Select "Utiliser par défaut" for it.
3. Start or open a chat session, ensure the session toggle is on "Cloud" (not "Local"), send a message.
4. Confirm the response's provider badge shows the BYOK provider's label, not "Mistral Cloud".
5. Trigger a deliverable (ask the agent for something concrete) and confirm artifacts still generate correctly — that path also now uses BYOK.
6. Turn on web search for one message and confirm it still returns sourced results — that path also now uses BYOK for the tool-calling step.

- [ ] **Step 5: Fallback path**

1. In "Mon compte", delete the working key and re-add an intentionally invalid one — expect the save to be REJECTED at this step (validation), not actually stored. To genuinely test runtime fallback, temporarily revoke the key on the provider's dashboard instead (or rename it in the DB to corrupt the ciphertext), then send a chat message.
2. Confirm the chat still responds (via Local or Mistral Fondio) and the provider badge reflects whichever actually answered — never a frozen/broken UI.
3. Check server logs (`npm run dev` console) for the `"BYOK indisponible, repli local/cloud :"` line confirming the failure was caught and logged, not silently swallowed without a trace.

- [ ] **Step 6: Restore a working state**

Re-add a valid key (or clear the preference back to `null` via "Revenir à Local / Mistral Fondio") so the app is left in a clean, working state.

No commit for this task — it's verification only. If any step uncovers a bug, fix it in the relevant task's files, re-run that task's tests, and commit the fix referencing which task it belongs to.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1, 2) · provider adapters for all 4 fournisseurs (Tasks 3-6) · models registry (Task 7) · key loading (Task 8) · settings API (Task 9) · status endpoint (Task 10) · chat route wiring (Task 11) · web-search/artifacts wiring (Task 12) · AccountScreen UI (Task 13) · ModelSelector UI (Task 14) · end-to-end + fallback verification (Task 15). All spec sections (data model, architecture, UI/UX, security, scope) have a corresponding task.
- **Known v1 simplification (documented, not a gap):** when BYOK fails AND the local/Mistral-Fondio fallback also fails (full 3-tier failure), the user-facing error reflects the local/cloud failure only; the BYOK failure reason is logged server-side (`console.error`) but not concatenated into the thrown error. This keeps `lib/llm.ts`'s control flow simple and matches YAGNI — full 3-tier failure is rare and still never blocks the user when at least one tier works.
- **Type consistency check:** `BYOKConfig`/`BYOKProviderId` defined once in `lib/llm.ts` (Task 3) and imported everywhere else (`lib/byok.ts`, `lib/artifacts.ts`, `lib/web-search.ts`, `app/api/chat/route.ts`, `app/api/account/api-keys/route.ts`) — no redefinition. `ModelStatus.byok` shape (Task 7) matches exactly what `/api/ollama-status` (Task 10) constructs and what `ModelSelector` (Task 14) reads (`configured`, `provider`, `label`, `chatModel`).

