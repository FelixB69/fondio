// Abstraction des appels LLM : tente Ollama en local, bascule sur Mistral
// (API EU, tier gratuit) si Ollama est injoignable ou si le modèle n'existe pas.

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3";
const OLLAMA_ARTIFACT_MODEL = process.env.OLLAMA_ARTIFACT_MODEL ?? "qwen2.5-coder:7b";

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

function localLabel(opts?: CallOptions): string {
  const model = pickOllamaModel(opts);
  return `${model} (local)`;
}

function cloudLabel(opts?: CallOptions): string {
  return `${pickMistralModel(opts)} (cloud)`;
}

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
        `Lance \`ollama serve\` ou ajoute MISTRAL_API_KEY dans .env.`,
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
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: true, messages }),
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
        `Lance \`ollama serve\` ou ajoute MISTRAL_API_KEY dans .env.`,
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
