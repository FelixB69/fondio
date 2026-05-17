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
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ChatRequest {
  sessionId: string;
  userMessage: string;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Parse une réponse Mistral au format texte avec sections marquées.
// Retourne { content, deliverables, challenges } — robuste : si rien ne matche
// on renvoie le texte brut comme content.
function parseAgentReply(raw: string): {
  content: string;
  deliverables: string[];
  challenges: string[];
} {
  const jsonMatch = raw.match(/\{[\s\S]*"message"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.message === "string") {
        return {
          content: parsed.message.trim(),
          deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
          challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
        };
      }
    } catch {
      // Tombe dans le parsing texte ci-dessous.
    }
  }

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

export async function POST(req: Request) {
  const { sessionId, userMessage } = (await req.json()) as ChatRequest;

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

  const ollamaMessages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    ...updatedHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3";

  const newTitle =
    session.title ?? userMsg.content.slice(0, 60) + (userMsg.content.length > 60 ? "…" : "");

  let ollamaRes: Response;
  try {
    ollamaRes = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true, messages: ollamaMessages }),
    });
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
  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Ollama a renvoyé ${ollamaRes.status} : ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const ollamaBody = ollamaRes.body;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      let raw = "";
      let buffer = "";
      const reader = ollamaBody.getReader();

      try {
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
              const json = JSON.parse(trimmed) as {
                message?: { content?: string };
                done?: boolean;
              };
              const chunk = json.message?.content;
              if (chunk) {
                raw += chunk;
                send({ t: "chunk", c: chunk });
              }
            } catch {
              // Ligne partielle ou JSON invalide — on ignore.
            }
          }
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
          baseUrl,
          conversation: updatedHistory,
          assistantReply: parsed.content,
          deliverableTitles: parsed.deliverables,
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

const ARTIFACT_MODEL = process.env.OLLAMA_ARTIFACT_MODEL ?? "qwen2.5-coder:7b";

async function generateArtifacts(args: {
  baseUrl: string;
  conversation: ChatMessage[];
  assistantReply: string;
  deliverableTitles: string[];
}): Promise<Artifact[]> {
  const { baseUrl, conversation, assistantReply, deliverableTitles } = args;

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
