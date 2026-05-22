import { NextResponse } from "next/server";
import {
  AGENTS,
  ARTIFACTS_FORMAT_PROMPT,
  buildSystemPrompt,
  type AgentId,
  type Artifact,
  type ChatMessage,
  type ProjectType,
} from "@/lib/data";
import {
  callChatModel,
  callChatModelStream,
  describeLLMError,
  type LLMMessage,
} from "@/lib/llm";
import { parseAgentReply } from "@/lib/parse-agent-reply";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ChatRequest {
  sessionId: string;
  userMessage: string;
  preferredProvider?: "local" | "cloud";
}

export async function POST(req: Request) {
  const { sessionId, userMessage, preferredProvider } = (await req.json()) as ChatRequest;

  if (!sessionId || !userMessage?.trim()) {
    return NextResponse.json({ error: "sessionId et userMessage requis." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id, agent_id, project_type, challenger_mode, messages, title")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: "Session introuvable." }, { status: 404 });
  }

  const agent = AGENTS[session.agent_id as AgentId];
  if (!agent) return NextResponse.json({ error: "Agent inconnu." }, { status: 400 });

  const history: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
  const now = new Date().toISOString();

  const userMsg: ChatMessage = { role: "user", content: userMessage.trim(), ts: now };
  const updatedHistory = [...history, userMsg];

  // Récupère les sessions précédentes du même agent pour injecter le contexte.
  const { data: prevSessions } = await supabase
    .from("sessions")
    .select("messages, title")
    .eq("agent_id", session.agent_id)
    .eq("user_id", user.id)
    .neq("id", sessionId)
    .order("updated_at", { ascending: false })
    .limit(3);

  let previousContext = "";
  if (prevSessions && prevSessions.length > 0) {
    const contextParts: string[] = [];
    for (const prev of prevSessions) {
      const msgs: ChatMessage[] = Array.isArray(prev.messages) ? prev.messages : [];
      if (msgs.length === 0) continue;
      const recent = msgs.slice(-6);
      const excerpt = recent
        .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content.slice(0, 400)}`)
        .join("\n");
      contextParts.push(`--- Session "${prev.title ?? "sans titre"}" ---\n${excerpt}`);
    }
    if (contextParts.length > 0) {
      previousContext = `\n\nContexte des conversations précédentes avec cet agent (pour continuité) :\n${contextParts.join("\n\n")}`;
    }
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const firstName = fullName.trim().split(/\s+/)[0] || "";
  const isFirstReply = history.length === 0;

  const systemPrompt =
    buildSystemPrompt(
      agent.id,
      session.challenger_mode,
      session.project_type as ProjectType,
      isFirstReply && firstName ? firstName : undefined,
    ) + previousContext;

  const llmMessages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...updatedHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  const newTitle =
    session.title ?? userMsg.content.slice(0, 60) + (userMsg.content.length > 60 ? "…" : "");

  let streamResult: Awaited<ReturnType<typeof callChatModelStream>>;
  try {
    streamResult = await callChatModelStream(llmMessages, { forceProvider: preferredProvider });
  } catch (e: unknown) {
    return NextResponse.json({ error: describeLLMError(e) }, { status: 503 });
  }
  const { provider, providerLabel, data: textStream } = streamResult;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      // Pré-annonce : on signale immédiatement au client quel provider répond,
      // avant même le 1er chunk. L'UI peut afficher "Réponse via …" en haut du
      // bloc qui se construit.
      send({ t: "provider", provider, providerLabel });

      let raw = "";

      try {
        for await (const chunk of textStream) {
          raw += chunk;
          send({ t: "chunk", c: chunk });
        }
      } catch (e: unknown) {
        send({
          t: "error",
          error: e instanceof Error ? e.message : "Erreur de streaming.",
        });
        controller.close();
        return;
      }

      raw = raw.trim();
      if (!raw) {
        send({ t: "error", error: "Réponse vide du modèle." });
        controller.close();
        return;
      }

      const parsed = parseAgentReply(raw);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: parsed.content,
        ts: new Date().toISOString(),
        provider,
        providerLabel,
      };
      if (parsed.deliverables.length) assistantMsg.deliverables = parsed.deliverables;
      if (parsed.challenges.length) assistantMsg.challenges = parsed.challenges;

      send({ t: "text-done", assistant: assistantMsg, title: newTitle });

      // 2e passe : si Mistral a annoncé des livrables, on demande à Qwen2.5-Coder
      // (meilleur en sortie structurée) de les matérialiser en artefacts JSON.
      // Échec silencieux : si Qwen n'est pas dispo ou répond mal, on garde juste
      // les titres bruts dans `deliverables`.
      if (parsed.deliverables.length) {
        const artifacts = await generateArtifacts({
          conversation: updatedHistory,
          assistantReply: parsed.content,
          deliverableTitles: parsed.deliverables,
          forceProvider: preferredProvider,
        });
        if (artifacts.length) {
          assistantMsg.artifacts = artifacts;
          send({ t: "artifacts", artifacts });
        }
      }

      const finalMessages = [...updatedHistory, assistantMsg];
      const { error: updErr } = await supabase
        .from("sessions")
        .update({
          messages: finalMessages,
          title: newTitle,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      if (updErr) send({ t: "error", error: updErr.message });

      send({ t: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function generateArtifacts(args: {
  conversation: ChatMessage[];
  assistantReply: string;
  deliverableTitles: string[];
  forceProvider?: "local" | "cloud";
}): Promise<Artifact[]> {
  const { conversation, assistantReply, deliverableTitles, forceProvider } = args;

  // On ne renvoie que les ~6 derniers tours pour limiter le contexte.
  const recent = conversation.slice(-6);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`)
    .join("\n\n");

  const userPrompt = `Conversation récente :

${transcript}

Dernière réponse de l'assistant :

${assistantReply}

L'assistant a annoncé ces livrables :
${deliverableTitles.map((t) => `- ${t}`).join("\n")}

Produis le contenu complet de chaque livrable au format JSON décrit.`;

  try {
    const { data: raw } = await callChatModel(
      [
        { role: "system", content: ARTIFACTS_FORMAT_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { jsonMode: true, useArtifactModel: true, forceProvider },
    );
    const parsed = JSON.parse(raw) as { artifacts?: unknown };
    if (!Array.isArray(parsed.artifacts)) return [];

    return parsed.artifacts.flatMap((a): Artifact[] => {
      if (!a || typeof a !== "object") return [];
      const obj = a as Record<string, unknown>;
      const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Livrable";

      if (obj.kind === "table") {
        const headers = Array.isArray(obj.headers)
          ? obj.headers.map((h) => String(h ?? ""))
          : [];
        const rows = Array.isArray(obj.rows)
          ? obj.rows
              .filter((r): r is unknown[] => Array.isArray(r))
              .map((r) => r.map((c) => String(c ?? "")))
          : [];
        if (!headers.length || !rows.length) return [];
        // Normalise la longueur des lignes pour matcher headers.
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
