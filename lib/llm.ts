// Abstraction des appels LLM : tente Ollama en local, bascule sur Mistral
// (API EU, tier gratuit) si Ollama est injoignable ou si le modèle n'existe pas.

import { modelLabel } from "./models";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3";
const OLLAMA_ARTIFACT_MODEL = process.env.OLLAMA_ARTIFACT_MODEL ?? "qwen2.5-coder:7b";
// Modèle dédié au tool-calling : il DOIT savoir gérer les outils (llama3 ne sait
// pas ; llama3.1 / qwen2.5 / mistral oui). Séparé du chat principal, comme l'est
// déjà le modèle d'artefacts.
const OLLAMA_TOOL_MODEL = process.env.OLLAMA_TOOL_MODEL ?? "llama3.1";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_BASE_URL = process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1";
const MISTRAL_MODEL = process.env.MISTRAL_MODEL ?? "mistral-small-latest";
const MISTRAL_ARTIFACT_MODEL = process.env.MISTRAL_ARTIFACT_MODEL ?? "codestral-latest";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallOptions {
  jsonMode?: boolean;
  useArtifactModel?: boolean;
  forceProvider?: "local" | "cloud";
}

export type LLMProvider = "local" | "cloud";

export interface LLMResult<T> {
  provider: LLMProvider;
  // Nom lisible pour l'UI (ex: "Llama 3 (local)", "Mistral Cloud").
  providerLabel: string;
  data: T;
}

// Libellés affichés à l'utilisateur : on délègue l'embellissement au registre
// central (lib/models.ts) pour n'avoir qu'UN seul endroit qui nomme les modèles.
function localLabel(opts?: CallOptions): string {
  return modelLabel(pickOllamaModel(opts), "local");
}

function cloudLabel(opts?: CallOptions): string {
  return modelLabel(pickMistralModel(opts), "cloud");
}

// Config réelle des modèles, exposée pour que /api/ollama-status la renvoie au
// client (qui affiche alors EXACTEMENT ce qui tourne, env personnalisé compris).
export const MODELS = {
  local: { chat: OLLAMA_MODEL, artifact: OLLAMA_ARTIFACT_MODEL, tool: OLLAMA_TOOL_MODEL },
  cloud: {
    chat: MISTRAL_MODEL,
    artifact: MISTRAL_ARTIFACT_MODEL,
    configured: Boolean(MISTRAL_API_KEY),
  },
} as const;

function isOllamaUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("model not found") ||
    msg.includes("OLLAMA_404")
  );
}

function pickOllamaModel(opts?: CallOptions) {
  return opts?.useArtifactModel ? OLLAMA_ARTIFACT_MODEL : OLLAMA_MODEL;
}

function pickMistralModel(opts?: CallOptions) {
  return opts?.useArtifactModel ? MISTRAL_ARTIFACT_MODEL : MISTRAL_MODEL;
}

// ── Appels non-streaming ────────────────────────────────────────────────────

export async function callChatModel(
  messages: LLMMessage[],
  opts?: CallOptions,
): Promise<LLMResult<string>> {
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

async function callOllamaJson(messages: LLMMessage[], opts?: CallOptions): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: pickOllamaModel(opts),
      stream: false,
      // Désactive le mode "réflexion" de Qwen3 : sinon il génère un long monologue
      // interne avant de répondre (lenteur + JSON pollué). Sans effet sur les
      // modèles qui n'ont pas ce mode (llama3, mistral...).
      think: false,
      ...(opts?.jsonMode ? { format: "json" } : {}),
      messages,
    }),
  });
  if (res.status === 404) throw new Error("OLLAMA_404 model not found");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  const raw = json.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Réponse vide du modèle.");
  return raw;
}

async function callMistralJson(messages: LLMMessage[], opts?: CallOptions): Promise<string> {
  if (!MISTRAL_API_KEY) {
    throw new Error(
      `Ollama injoignable sur ${OLLAMA_BASE_URL} et MISTRAL_API_KEY non configurée. ` +
        `Lancez \`ollama serve\` ou ajoutez MISTRAL_API_KEY dans .env.`,
    );
  }
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: pickMistralModel(opts),
      messages,
      stream: false,
      ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mistral ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Réponse vide du modèle.");
  return raw;
}

// ── Tool-calling (appel d'outils) ────────────────────────────────────────────
//
// "Tool-calling" = on DÉCRIT au modèle des outils (des fonctions) qu'il peut
// demander à exécuter. Le modèle ne lance rien lui-même : il répond "j'aimerais
// appeler web_search avec query=...". C'est NOTRE code qui exécute, puis renvoie
// le résultat ; le modèle peut alors répondre ou demander un autre outil.
// Tous les modèles ne savent pas faire ça : on tente d'abord un modèle local
// compatible (OLLAMA_TOOL_MODEL), puis on bascule sur Mistral Cloud.

// Description d'un outil, au format attendu par l'API (un bout de "JSON Schema").
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Une demande d'outil émise par le modèle.
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // chaîne JSON, ex : '{"query":"..."}'
}

// Résultat d'un tour : soit du texte (le modèle a fini), soit des demandes d'outils.
export interface ToolTurnResult {
  content: string;
  toolCalls: ToolCall[];
}

// Un message du fil de tool-calling, en format NORMALISÉ (indépendant du
// fournisseur). On le traduit ensuite vers le format propre à Ollama ou Mistral.
export interface ToolLoopMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[]; // message assistant qui demande des outils
  toolCallId?: string;    // message "tool" : la demande à laquelle il répond
  name?: string;          // message "tool" : le nom de l'outil
}

function safeParseArgs(s: string): Record<string, unknown> {
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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

// Alias d'export réservé aux tests — la fonction reste interne au module pour
// le code applicatif (accédée via callByokJson dans Task 6).
export { callAnthropicJson as callAnthropicJsonForTest };

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

// Ollama veut les arguments d'outil en OBJET, et n'utilise pas d'identifiant.
function toOllamaToolMessages(messages: ToolLoopMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((t) => ({
          function: { name: t.name, arguments: safeParseArgs(t.arguments) },
        })),
      };
    }
    if (m.role === "tool") return { role: "tool", content: m.content };
    return { role: m.role, content: m.content };
  });
}

// Mistral (comme OpenAI) veut les arguments en CHAÎNE JSON, et relie demande et
// réponse d'outil par un identifiant (tool_call_id).
function toMistralToolMessages(messages: ToolLoopMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, name: m.name, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

async function callOllamaTools(messages: ToolLoopMessage[], tools: ToolDef[]): Promise<ToolTurnResult> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_TOOL_MODEL,
      messages: toOllamaToolMessages(messages),
      tools,
      stream: false,
      think: false,
    }),
  });
  if (res.status === 404) throw new Error("OLLAMA_404 model not found");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama tools ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    message?: {
      content?: string;
      tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
    };
  };
  const msg = json.message;
  return {
    content: msg?.content ?? "",
    toolCalls: (msg?.tool_calls ?? []).map((t, i) => ({
      id: `call_${i}`, // Ollama ne fournit pas d'id : on en fabrique un, stable dans ce tour.
      name: t.function.name,
      arguments: JSON.stringify(t.function.arguments ?? {}),
    })),
  };
}

async function callMistralTools(messages: ToolLoopMessage[], tools: ToolDef[]): Promise<ToolTurnResult> {
  if (!MISTRAL_API_KEY) {
    throw new Error("TOOLS_NO_CLOUD: le tool-calling cloud nécessite MISTRAL_API_KEY.");
  }
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: toMistralToolMessages(messages),
      tools,
      tool_choice: "auto", // "auto" = le modèle décide d'appeler un outil ou non
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mistral tools ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  return {
    content: msg?.content ?? "",
    toolCalls: (msg?.tool_calls ?? []).map((t) => ({
      id: t.id,
      name: t.function.name,
      arguments: t.function.arguments,
    })),
  };
}

// Un tour de tool-calling, avec le même réflexe que le reste du fichier : Ollama
// local d'abord (modèle OLLAMA_TOOL_MODEL), bascule Mistral Cloud sinon.
export async function callModelWithTools(
  messages: ToolLoopMessage[],
  tools: ToolDef[],
  opts?: { forceProvider?: LLMProvider },
): Promise<LLMResult<ToolTurnResult>> {
  if (opts?.forceProvider === "cloud") {
    const data = await callMistralTools(messages, tools);
    return { provider: "cloud", providerLabel: modelLabel(MISTRAL_MODEL, "cloud"), data };
  }
  try {
    const data = await callOllamaTools(messages, tools);
    return { provider: "local", providerLabel: modelLabel(OLLAMA_TOOL_MODEL, "local"), data };
  } catch (e) {
    // Si l'utilisateur a forcé "local", on ne triche pas : on remonte l'erreur.
    if (opts?.forceProvider === "local") throw e;
    // Sinon (Ollama injoignable, modèle non installé ou incompatible outils) → cloud.
    const data = await callMistralTools(messages, tools);
    return { provider: "cloud", providerLabel: modelLabel(MISTRAL_MODEL, "cloud"), data };
  }
}

// ── Streaming ───────────────────────────────────────────────────────────────

// Retourne un async iterable de chunks de texte + le provider utilisé.
export async function callChatModelStream(
  messages: LLMMessage[],
  opts?: Pick<CallOptions, "forceProvider">,
): Promise<LLMResult<AsyncIterable<string>>> {
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

async function callMistralStream(messages: LLMMessage[]): Promise<AsyncIterable<string>> {
  if (!MISTRAL_API_KEY) {
    throw new Error(
      `Ollama injoignable sur ${OLLAMA_BASE_URL} et MISTRAL_API_KEY non configurée. ` +
        `Lancez \`ollama serve\` ou ajoutez MISTRAL_API_KEY dans .env.`,
    );
  }
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({ model: MISTRAL_MODEL, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mistral ${res.status}: ${text.slice(0, 200)}`);
  }
  return mistralStreamToText(res.body);
}

async function* ollamaStreamToText(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
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
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed) as { message?: { content?: string } };
        const chunk = json.message?.content;
        if (chunk) yield chunk;
      } catch {
        // Ligne partielle ou JSON invalide — on ignore.
      }
    }
  }
}

async function* mistralStreamToText(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE : événements séparés par \n\n, mais on parse ligne à ligne.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch {
        // ignore
      }
    }
  }
}

// Helper pour formater le message d'erreur côté UI.
export function describeLLMError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Erreur inconnue";
  if (msg === "OLLAMA_LOCAL_FORCED_UNAVAILABLE") {
    return `OLLAMA_UNAVAILABLE: Ollama n'est pas accessible sur ${OLLAMA_BASE_URL}. Lance \`ollama serve\` ou bascule sur Cloud.`;
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    return `Ollama n'est pas démarré sur ${OLLAMA_BASE_URL}. Lance \`ollama serve\` ou bascule sur Cloud.`;
  }
  return msg;
}
