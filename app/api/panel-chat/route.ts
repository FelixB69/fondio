import { NextResponse } from "next/server";
import {
  AGENTS,
  ARTIFACTS_FORMAT_PROMPT,
  buildPanelAgentPrompt,
  buildSynthesisSystemPrompt,
  type AgentId,
  type Artifact,
  type ChatMessage,
} from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface AgentStepRequest {
  sessionId: string;
  agentIds: AgentId[];
  step: number;
  previousReplies: Array<{ agentId: AgentId; content: string }>;
  userMessage?: string; // requis pour step 0
  isSynthesis?: false;
}

interface SynthesisRequest {
  sessionId: string;
  agentIds: AgentId[];
  isSynthesis: true;
  userMessage: string;
  allReplies: Array<{ agentId: AgentId; content: string }>;
}

type PanelChatRequest = AgentStepRequest | SynthesisRequest;

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function parseAgentReply(raw: string): {
  content: string;
  deliverables: string[];
  challenges: string[];
} {
  const extractSection = (label: string): { items: string[]; start: number; end: number } => {
    const re = new RegExp(`^[\\s>*_-]*${label}\\s*:?\\s*$`, "im");
    const m = raw.match(re);
    if (!m || m.index === undefined) return { items: [], start: -1, end: -1 };
    const start = m.index;
    const after = raw.slice(start + m[0].length);
    const stopMatch = after.match(/\n\s*[A-ZÉÈÀ]{3,}[A-ZÉÈÀ ]*:/);
    const stopIdx = stopMatch && stopMatch.index !== undefined ? stopMatch.index : after.length;
    const block = after.slice(0, stopIdx);
    const items = block
      .split("\n")
      .map((line) => line.replace(/^[\s>*_-]+/, "").trim())
      .filter((line) => line.length > 0);
    return { items, start, end: start + m[0].length + stopIdx };
  };

  const liv = extractSection("LIVRABLES");
  const cha = extractSection("CHALLENGES");

  const cuts = [liv.start, cha.start].filter((n) => n >= 0);
  const cutAt = cuts.length > 0 ? Math.min(...cuts) : raw.length;
  const content = raw.slice(0, cutAt).trim();

  return {
    content: content || raw.trim(),
    deliverables: liv.items,
    challenges: cha.items,
  };
}

async function callOllama(
  baseUrl: string,
  model: string,
  messages: OllamaMessage[],
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  const raw = json.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Réponse vide du modèle.");
  return raw;
}

async function generateArtifacts(args: {
  baseUrl: string;
  conversation: ChatMessage[];
  assistantReply: string;
  deliverableTitles: string[];
}): Promise<Artifact[]> {
  const { baseUrl, conversation, assistantReply, deliverableTitles } = args;
  const ARTIFACT_MODEL = process.env.OLLAMA_ARTIFACT_MODEL ?? "qwen2.5-coder:7b";

  const recent = conversation.slice(-6);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`)
    .join("\n\n");

  const userPrompt = `Conversation récente :\n\n${transcript}\n\nDernière réponse :\n\n${assistantReply}\n\nLivrables annoncés :\n${deliverableTitles.map((t) => `- ${t}`).join("\n")}\n\nProduis le contenu complet de chaque livrable au format JSON décrit.`;

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ARTIFACT_MODEL,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: ARTIFACTS_FORMAT_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { message?: { content?: string } };
    const raw = json.message?.content?.trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw) as { artifacts?: unknown };
    if (!Array.isArray(parsed.artifacts)) return [];

    return parsed.artifacts.flatMap((a): Artifact[] => {
      if (!a || typeof a !== "object") return [];
      const obj = a as Record<string, unknown>;
      const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Livrable";

      if (obj.kind === "table") {
        const headers = Array.isArray(obj.headers) ? obj.headers.map((h) => String(h ?? "")) : [];
        const rows = Array.isArray(obj.rows)
          ? obj.rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map((c) => String(c ?? "")))
          : [];
        if (!headers.length || !rows.length) return [];
        const normalized = rows.map((r) => {
          if (r.length === headers.length) return r;
          if (r.length < headers.length) return [...r, ...Array(headers.length - r.length).fill("")];
          return r.slice(0, headers.length);
        });
        return [{ kind: "table", title, headers, rows: normalized }];
      }

      if (obj.kind === "document") {
        const markdown = typeof obj.markdown === "string" ? obj.markdown.trim() : "";
        if (!markdown) return [];
        return [{ kind: "document", title, markdown }];
      }

      return [];
    });
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as PanelChatRequest;
  const { sessionId, agentIds } = body;

  if (!sessionId || !agentIds?.length) {
    return NextResponse.json({ error: "sessionId et agentIds requis." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id, agent_id, messages, title")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: "Session introuvable." }, { status: 404 });
  }

  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3";
  const history: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
  const now = new Date().toISOString();

  // ── Étape de synthèse ────────────────────────────────────────────────────
  if (body.isSynthesis) {
    const { allReplies, userMessage } = body;

    const repliesText = allReplies
      .map((r) => `--- ${AGENTS[r.agentId].name} ---\n${r.content}`)
      .join("\n\n");

    const ollamaMessages: OllamaMessage[] = [
      { role: "system", content: buildSynthesisSystemPrompt() },
      {
        role: "user",
        content: `Question posée au panel : "${userMessage}"\n\nRéponses des experts :\n\n${repliesText}\n\nProduis maintenant ta synthèse.`,
      },
    ];

    let raw: string;
    try {
      raw = await callOllama(baseUrl, model, ollamaMessages);
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur Ollama." }, { status: 503 });
    }

    const parsed = parseAgentReply(raw);
    const synthesisMsg: ChatMessage = {
      role: "assistant",
      agentId: "__synthesis__",
      content: parsed.content,
      ts: now,
    };
    if (parsed.deliverables.length) synthesisMsg.deliverables = parsed.deliverables;

    const finalMessages = [...history, synthesisMsg];
    await supabase
      .from("sessions")
      .update({ messages: finalMessages, updated_at: now })
      .eq("id", sessionId);

    return NextResponse.json({ message: synthesisMsg });
  }

  // ── Étape d'un agent ─────────────────────────────────────────────────────
  const { step, previousReplies, userMessage } = body as AgentStepRequest;
  const agentId = agentIds[step];
  if (!agentId || !AGENTS[agentId]) {
    return NextResponse.json({ error: `Agent inconnu à l'étape ${step}.` }, { status: 400 });
  }

  let updatedHistory = [...history];
  let title = session.title as string | null;

  // Étape 0 : ajouter le message utilisateur
  if (step === 0) {
    if (!userMessage?.trim()) {
      return NextResponse.json({ error: "userMessage requis pour step 0." }, { status: 400 });
    }
    const userMsg: ChatMessage = { role: "user", content: userMessage.trim(), ts: now };
    updatedHistory = [...history, userMsg];
    title = title ?? userMessage.trim().slice(0, 60) + (userMessage.trim().length > 60 ? "…" : "");
  }

  const systemPrompt = buildPanelAgentPrompt(agentId, agentIds, previousReplies ?? []);

  // On n'inclut que les messages user dans l'historique Ollama (les réponses
  // des autres agents panel sont injectées via le system prompt).
  const ollamaMessages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    ...updatedHistory
      .filter((m) => m.role === "user")
      .map((m) => ({ role: "user" as const, content: m.content })),
  ];

  let raw: string;
  try {
    raw = await callOllama(baseUrl, model, ollamaMessages);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    const isConnRefused = msg.includes("ECONNREFUSED") || msg.includes("fetch failed");
    return NextResponse.json(
      {
        error: isConnRefused
          ? `Ollama n'est pas démarré sur ${baseUrl}. Lance \`ollama serve\` dans un terminal.`
          : msg,
      },
      { status: 503 },
    );
  }

  const parsed = parseAgentReply(raw);
  const agentMsg: ChatMessage = {
    role: "assistant",
    agentId,
    content: parsed.content,
    ts: now,
  };
  if (parsed.deliverables.length) agentMsg.deliverables = parsed.deliverables;
  if (parsed.challenges.length) agentMsg.challenges = parsed.challenges;

  // Génération d'artefacts si des livrables ont été annoncés
  if (parsed.deliverables.length) {
    const artifacts = await generateArtifacts({
      baseUrl,
      conversation: updatedHistory,
      assistantReply: parsed.content,
      deliverableTitles: parsed.deliverables,
    });
    if (artifacts.length) agentMsg.artifacts = artifacts;
  }

  const finalMessages = [...updatedHistory, agentMsg];
  await supabase
    .from("sessions")
    .update({ messages: finalMessages, title, updated_at: now })
    .eq("id", sessionId);

  return NextResponse.json({ message: agentMsg, title: step === 0 ? title : undefined });
}
