// Abstraction des appels LLM : tente Ollama en local, bascule sur Mistral
// (API EU, tier gratuit) si Ollama est injoignable ou si le modèle n'existe pas.

import { modelLabel } from "./models";
import { OLLAMA_AUTH_ERROR, ollamaBaseUrl, ollamaFetch, ollamaHint } from "./ollama";

const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3";
const OLLAMA_ARTIFACT_MODEL = process.env.OLLAMA_ARTIFACT_MODEL ?? "qwen2.5-coder:7b";
// Modèle dédié au tool-calling : il DOIT savoir gérer les outils (llama3 ne sait
// pas ; llama3.1 / qwen2.5 / mistral oui). Séparé du chat principal, comme l'est
// déjà le modèle d'artefacts.
const OLLAMA_TOOL_MODEL = process.env.OLLAMA_TOOL_MODEL ?? "llama3.1";

// Lu en différé (fonction, pas const au chargement du module) : permet aux
// tests de positionner process.env.MISTRAL_API_KEY après l'import du module,
// et reflète un éventuel changement d'env sans redémarrage du process.
function getMistralApiKey(): string | undefined {
  return process.env.MISTRAL_API_KEY;
}
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
  byok?: BYOKConfig | null;
}

export type LLMProvider = "local" | "cloud" | "byok";

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
    configured: Boolean(getMistralApiKey()),
  },
} as const;

function isOllamaUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("model not found") ||
    msg.includes("OLLAMA_404") ||
    // Serveur distant derrière un reverse proxy : le proxy répond alors que
    // Ollama, lui, est arrêté ou saturé. C'est bien une indisponibilité → repli
    // cloud, contrairement au 401/403 (identifiants) qu'on laisse remonter.
    /Ollama( tools)? (502|503|504)/.test(msg)
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

async function callOllamaJson(messages: LLMMessage[], opts?: CallOptions): Promise<string> {
  const res = await ollamaFetch("/api/chat", {
    method: "POST",
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
  const apiKey = getMistralApiKey();
  if (!apiKey) {
    throw new Error(
      `Ollama injoignable sur ${ollamaBaseUrl()} et MISTRAL_API_KEY non configurée. ` +
        `${ollamaHint()} Ou ajoutez MISTRAL_API_KEY dans .env.`,
    );
  }
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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

// ── Dispatch BYOK ────────────────────────────────────────────────────────────
//
// Table des modèles par défaut pour chaque fournisseur BYOK : un modèle "chat"
// (conversation normale) et un modèle "artifact" (génération de documents,
// même logique que pickOllamaModel/pickMistralModel plus haut).

const BYOK_MODELS: Record<BYOKProviderId, { chat: string; artifact: string; label: string }> = {
  anthropic: { chat: "claude-sonnet-4-6", artifact: "claude-sonnet-4-6", label: "Claude Sonnet" },
  openai: { chat: "gpt-4o-mini", artifact: "gpt-4o-mini", label: "GPT-4o mini" },
  google: { chat: "gemini-2.0-flash", artifact: "gemini-2.0-flash", label: "Gemini Flash" },
  mistral_byok: { chat: "mistral-small-latest", artifact: "codestral-latest", label: "Mistral Small" },
};

// Lecture seule pour /api/ollama-status — pas besoin d'exposer l'objet complet
// (qui contient aussi le modèle "artifact", non pertinent pour l'UI de statut).
export const BYOK_CHAT_MODELS: Record<BYOKProviderId, string> = Object.fromEntries(
  Object.entries(BYOK_MODELS).map(([k, v]) => [k, v.chat]),
) as Record<BYOKProviderId, string>;

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

async function callByokStream(
  byok: BYOKConfig,
  messages: LLMMessage[],
  opts?: CallOptions,
): Promise<AsyncIterable<string>> {
  const model = byokModelFor(byok, opts);
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

// Exports internes réservés aux tests (lib/llm.test.ts) — pas utilisés par le
// reste de l'app, qui passe toujours par callChatModel/Stream ou callModelWithTools.
export {
  callAnthropicJson as __callAnthropicJsonForTest,
  callOpenAICompatibleJson as __callOpenAICompatibleJsonForTest,
  callGoogleJson as __callGoogleJsonForTest,
};

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
  const res = await ollamaFetch("/api/chat", {
    method: "POST",
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
  const apiKey = getMistralApiKey();
  if (!apiKey) {
    throw new Error("TOOLS_NO_CLOUD: le tool-calling cloud nécessite MISTRAL_API_KEY.");
  }
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
    // Si l'utilisateur a forcé "local", on ne triche pas : on remonte l'erreur.
    if (opts?.forceProvider === "local") throw e;
    // Sinon (Ollama injoignable, modèle non installé ou incompatible outils) → cloud.
    const data = await callMistralTools(messages, tools);
    return { provider: "cloud", providerLabel: modelLabel(MISTRAL_MODEL, "cloud"), data };
  }
}

// ── Streaming ───────────────────────────────────────────────────────────────

// Retourne un async iterable de chunks de texte + le provider utilisé.
// `useArtifactModel` bascule sur le modèle spécialisé code (qwen2.5-coder en
// local, Codestral en cloud) : c'est ce que demande le tour du Maquettiste, dont
// la sortie est un fichier HTML entier et non de la conversation.
export async function callChatModelStream(
  messages: LLMMessage[],
  opts?: Pick<CallOptions, "forceProvider" | "useArtifactModel"> & { byok?: BYOKConfig | null },
): Promise<LLMResult<AsyncIterable<string>>> {
  if (opts?.byok && opts.forceProvider !== "local") {
    try {
      const data = await callByokStream(opts.byok, messages, opts);
      return { provider: "byok", providerLabel: byokProviderLabel(opts.byok), data };
    } catch (e) {
      console.error("BYOK indisponible, repli local/cloud :", describeByokError(opts.byok, e));
    }
  }
  if (opts?.forceProvider === "cloud") {
    const data = await callMistralStream(messages, opts);
    return { provider: "cloud", providerLabel: cloudLabel(opts), data };
  }
  try {
    const res = await ollamaFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ model: pickOllamaModel(opts), stream: true, think: false, messages }),
    });
    if (res.status === 404) throw new Error("OLLAMA_404 model not found");
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
    }
    return {
      provider: "local",
      providerLabel: localLabel(opts),
      data: ollamaStreamToText(res.body),
    };
  } catch (e) {
    if (!isOllamaUnavailable(e)) throw e;
    if (opts?.forceProvider === "local") throw new Error("OLLAMA_LOCAL_FORCED_UNAVAILABLE");
    const data = await callMistralStream(messages, opts);
    return { provider: "cloud", providerLabel: cloudLabel(opts), data };
  }
}

async function callMistralStream(
  messages: LLMMessage[],
  opts?: CallOptions,
): Promise<AsyncIterable<string>> {
  const apiKey = getMistralApiKey();
  if (!apiKey) {
    throw new Error(
      `Ollama injoignable sur ${ollamaBaseUrl()} et MISTRAL_API_KEY non configurée. ` +
        `${ollamaHint()} Ou ajoutez MISTRAL_API_KEY dans .env.`,
    );
  }
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: pickMistralModel(opts), messages, stream: true }),
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
    return `OLLAMA_UNAVAILABLE: Ollama n'est pas accessible sur ${ollamaBaseUrl()}. ${ollamaHint()}`;
  }
  // Authentification refusée par le serveur Ollama : ce n'est pas une panne mais
  // une config à corriger, donc on le dit explicitement au lieu de suggérer un
  // redémarrage qui n'y changera rien.
  if (msg.startsWith(OLLAMA_AUTH_ERROR)) {
    return `Le serveur Ollama (${ollamaBaseUrl()}) a refusé les identifiants. Vérifiez OLLAMA_USER / OLLAMA_PASSWORD.`;
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    return `Ollama n'est pas démarré sur ${ollamaBaseUrl()}. ${ollamaHint()}`;
  }
  return msg;
}
