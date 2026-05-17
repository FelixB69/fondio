import { NextResponse } from "next/server";
import {
  AGENTS,
  ARTIFACTS_FORMAT_PROMPT,
  buildPanelAgentPrompt,
  buildSynthesisSystemPrompt,
  type AgentId,
  type Artifact,
  type ChatMessage,
  type ProjectType,
} from "@/lib/data";
import { callChatModel, describeLLMError, type LLMMessage } from "@/lib/llm";
import { parseAgentReply } from "@/lib/parse-agent-reply";
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

async function generateArtifacts(args: {
  conversation: ChatMessage[];
  assistantReply: string;
  deliverableTitles: string[];
}): Promise<Artifact[]> {
  const { conversation, assistantReply, deliverableTitles } = args;

  const recent = conversation.slice(-6);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`)
    .join("\n\n");

  const userPrompt = `Conversation récente :\n\n${transcript}\n\nDernière réponse :\n\n${assistantReply}\n\nLivrables annoncés :\n${deliverableTitles.map((t) => `- ${t}`).join("\n")}\n\nProduis le contenu complet de chaque livrable au format JSON décrit.`;

  try {
    const { data: raw } = await callChatModel(
      [
        { role: "system", content: ARTIFACTS_FORMAT_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { jsonMode: true, useArtifactModel: true },
    );
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
    .select("id, agent_id, project_type, messages, title")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: "Session introuvable." }, { status: 404 });
  }

  const history: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
  const now = new Date().toISOString();

  // ── Étape de synthèse ────────────────────────────────────────────────────
  if (body.isSynthesis) {
    const { allReplies, userMessage } = body;

    const repliesText = allReplies
      .map((r) => `--- ${AGENTS[r.agentId].name} ---\n${r.content}`)
      .join("\n\n");

    const llmMessages: LLMMessage[] = [
      { role: "system", content: buildSynthesisSystemPrompt() },
      {
        role: "user",
        content: `Question posée au panel : "${userMessage}"\n\nRéponses des experts :\n\n${repliesText}\n\nProduis maintenant ta synthèse.`,
      },
    ];

    let raw: string;
    let provider: "local" | "cloud";
    let providerLabel: string;
    try {
      const result = await callChatModel(llmMessages);
      raw = result.data;
      provider = result.provider;
      providerLabel = result.providerLabel;
    } catch (e: unknown) {
      return NextResponse.json({ error: describeLLMError(e) }, { status: 503 });
    }

    const parsed = parseAgentReply(raw);
    const synthesisMsg: ChatMessage = {
      role: "assistant",
      agentId: "__synthesis__",
      content: parsed.content,
      ts: now,
      provider,
      providerLabel,
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

  const fullName =
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const firstName = fullName.trim().split(/\s+/)[0] || "";
  // Saluer uniquement sur le tout premier message de la session, et seulement
  // par le premier agent du panel (step 0 sans réponses précédentes).
  const isFirstReply =
    history.length === 0 && step === 0 && (previousReplies?.length ?? 0) === 0;

  const systemPrompt = buildPanelAgentPrompt(
    agentId,
    agentIds,
    previousReplies ?? [],
    session.project_type as ProjectType,
    isFirstReply && firstName ? firstName : undefined,
  );

  // On n'inclut que les messages user dans l'historique (les réponses
  // des autres agents panel sont injectées via le system prompt).
  const llmMessages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...updatedHistory
      .filter((m) => m.role === "user")
      .map((m) => ({ role: "user" as const, content: m.content })),
  ];

  let raw: string;
  let provider: "local" | "cloud";
  let providerLabel: string;
  try {
    const result = await callChatModel(llmMessages);
    raw = result.data;
    provider = result.provider;
    providerLabel = result.providerLabel;
  } catch (e: unknown) {
    return NextResponse.json({ error: describeLLMError(e) }, { status: 503 });
  }

  const parsed = parseAgentReply(raw);
  const agentMsg: ChatMessage = {
    role: "assistant",
    agentId,
    content: parsed.content,
    ts: now,
    provider,
    providerLabel,
  };
  if (parsed.deliverables.length) agentMsg.deliverables = parsed.deliverables;
  if (parsed.challenges.length) agentMsg.challenges = parsed.challenges;

  // Génération d'artefacts si des livrables ont été annoncés
  if (parsed.deliverables.length) {
    const artifacts = await generateArtifacts({
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
