import { NextResponse } from "next/server";
import {
  AGENTS,
  buildSystemPrompt,
  type AgentId,
  type ChatMessage,
  type ProjectType,
} from "@/lib/data";
import { generateArtifacts } from "@/lib/artifacts";
import { loadUserByokConfig, type SupabaseLike } from "@/lib/byok";
import { callChatModelStream, describeLLMError, type LLMMessage } from "@/lib/llm";
import { parseAgentReply } from "@/lib/parse-agent-reply";
import { createClient } from "@/lib/supabase/server";
import { gatherWebContext } from "@/lib/web-search";

export const runtime = "nodejs";

interface ChatRequest {
  sessionId: string;
  userMessage: string;
  preferredProvider?: "local" | "cloud";
  // Recherche web activée par l'utilisateur (bouton dans le chat). Off par défaut.
  webSearch?: boolean;
  // Régénération : on rejoue le DERNIER tour utilisateur (sans réajouter son
  // message) après avoir retiré la réponse précédente de l'assistant.
  regenerate?: boolean;
}

export async function POST(req: Request) {
  const { sessionId, userMessage, preferredProvider, webSearch, regenerate } =
    (await req.json()) as ChatRequest;

  if (!sessionId || (!regenerate && !userMessage?.trim())) {
    return NextResponse.json({ error: "sessionId et userMessage requis." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  // BYOK seulement si l'utilisateur n'a pas explicitement choisi "local" pour
  // cette session — cohérent avec la résolution dans lib/llm.ts.
  // (Cast nécessaire : le client Supabase réel a un type de retour bien plus
  // riche/profond que `SupabaseLike`, le sous-ensemble minimal utilisé pour
  // mocker facilement loadUserByokConfig dans les tests.)
  const byok =
    preferredProvider === "local"
      ? null
      : await loadUserByokConfig(supabase as unknown as SupabaseLike, user.id);

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

  let history: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
  const now = new Date().toISOString();

  // Régénération : on retire la (les) dernière(s) réponse(s) assistant et on
  // rejoue le dernier message utilisateur sans le réécrire. Sinon, tour normal :
  // on ajoute le message utilisateur à l'historique.
  let updatedHistory: ChatMessage[];
  if (regenerate) {
    while (history.length && history[history.length - 1].role === "assistant") {
      history = history.slice(0, -1);
    }
    if (!history.length || history[history.length - 1].role !== "user") {
      return NextResponse.json({ error: "Aucun message à régénérer." }, { status: 400 });
    }
    updatedHistory = history;
  } else {
    const userMsg: ChatMessage = { role: "user", content: userMessage.trim(), ts: now };
    updatedHistory = [...history, userMsg];
  }
  const lastUserContent =
    [...updatedHistory].reverse().find((m) => m.role === "user")?.content ?? "";

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

  // Recherche web : on cherche des infos réelles à partir du message, et on les
  // injectera dans le prompt (comme previousContext ci-dessus). Si la recherche
  // échoue (clé absente, réseau coupé, quota...), on continue SANS : une option
  // de confort ne doit jamais faire planter le chat. D'où le try/catch.
  let webContext = "";
  // On garde aussi la liste des sources (titre + url) pour l'accrocher à la
  // réponse : l'UI en fera des liens cliquables. L'ordre est le même que la
  // numérotation [1], [2]... injectée dans le prompt.
  let webSources: { title: string; url: string }[] = [];
  // Recherche web seulement si l'utilisateur a activé le bouton (sinon la réponse
  // s'affiche tout de suite, sans étape de recherche préalable → bien plus rapide).
  // La logique (tool-calling puis fallback) vit dans lib/web-search.ts, partagée
  // avec le panel.
  if (webSearch) {
    const research = await gatherWebContext(updatedHistory, preferredProvider, byok);
    webContext = research.webContext;
    webSources = research.sources;
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const firstName = fullName.trim().split(/\s+/)[0] || "";
  const isFirstReply = history.length === 0;

  // Quand on injecte un gros bloc de résultats web, les consignes de format (la
  // section LIVRABLES) se retrouvent loin de la fin du prompt et un petit modèle
  // les « oublie ». On les ré-assène APRÈS le contexte web (effet de récence) et
  // on rappelle de citer les sources — sinon ni livrables ni citations [1][2].
  const webFormatReminder = webContext
    ? "\n\nRAPPEL : appuie-toi sur les informations web ci-dessus et cite-les avec [1], [2]… quand tu les utilises. Puis, si tu livres quelque chose de concret, termine ta réponse par une section `LIVRABLES:` (ce mot exact, seul sur sa ligne, sans markdown) suivie de 1 à 3 puces."
    : "";

  const systemPrompt =
    buildSystemPrompt(
      agent.id,
      session.challenger_mode,
      session.project_type as ProjectType,
      isFirstReply && firstName ? firstName : undefined,
    ) + previousContext + webContext + webFormatReminder;

  const llmMessages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...updatedHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  const newTitle =
    session.title ?? lastUserContent.slice(0, 60) + (lastUserContent.length > 60 ? "…" : "");

  let streamResult: Awaited<ReturnType<typeof callChatModelStream>>;
  try {
    streamResult = await callChatModelStream(llmMessages, { forceProvider: preferredProvider, byok });
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
      if (webSources.length) assistantMsg.sources = webSources;

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
          byok,
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
