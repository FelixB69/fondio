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
  callModelWithTools,
  describeLLMError,
  type LLMMessage,
  type ToolDef,
  type ToolLoopMessage,
} from "@/lib/llm";
import { parseAgentReply } from "@/lib/parse-agent-reply";
import { createClient } from "@/lib/supabase/server";
import { searchWeb, formatWebResultsForPrompt } from "@/lib/web-search";

export const runtime = "nodejs";

interface ChatRequest {
  sessionId: string;
  userMessage: string;
  preferredProvider?: "local" | "cloud";
  // Recherche web activée par l'utilisateur (bouton dans le chat). Off par défaut.
  webSearch?: boolean;
}

export async function POST(req: Request) {
  const { sessionId, userMessage, preferredProvider, webSearch } = (await req.json()) as ChatRequest;

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
  if (webSearch) {
    // Étape 1 : tool-calling natif. Le modèle appelle lui-même web_search.
    // S'il répond "FINI" sans appeler d'outil, c'est une DÉCISION (aucune
    // recherche utile) : on la respecte, webContext reste vide, et on s'arrête là.
    let toolCallingFailed = false;
    try {
      const research = await runWebResearch(updatedHistory, preferredProvider);
      webContext = research.webContext;
      webSources = research.sources;
    } catch (e) {
      // On ne tombe en étape 2 QUE si le tool-calling n'a pas pu tourner du tout
      // (modèle sans support des outils, Ollama injoignable...). Sinon on
      // re-générerait pour rien : c'est ce qui doublait le temps de réponse.
      console.error("Tool-calling indisponible :", e);
      toolCallingFailed = true;
    }

    // Étape 2 : fallback manuel, seulement si l'étape 1 n'a pas pu s'exécuter.
    // On demande au modèle "faut-il chercher, et quelle requête ?", puis on
    // cherche directement. Marche même sur un modèle sans support des outils.
    if (toolCallingFailed) {
      try {
        const query = await decideSearchQuery(updatedHistory, preferredProvider);
        if (query) {
          const search = await searchWeb(query);
          webContext = formatWebResultsForPrompt(search);
          webSources = search.results.map((r) => ({ title: r.title, url: r.url }));
        }
      } catch (e2) {
        console.error("Recherche web ignorée :", e2);
      }
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
    ) + previousContext + webContext;

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

// Définition de l'outil exposé au modèle : une fonction "web_search" qui prend
// une requête. Le modèle lit cette description pour décider quand l'appeler.
const WEB_SEARCH_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Recherche des informations récentes et factuelles sur le web (chiffres, prix, concurrents, taille de marché, tendances, actualités). À utiliser dès qu'une donnée vérifiable et à jour manque pour répondre.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La requête de recherche, formulée comme une recherche Google.",
        },
      },
      required: ["query"],
    },
  },
};

// Boucle d'agent en TOOL-CALLING NATIF. On donne l'outil web_search au modèle ;
// il décide lui-même s'il l'appelle (et peut l'appeler plusieurs fois pour
// creuser). On exécute chaque recherche, on lui renvoie le résultat, et on
// recommence jusqu'à ce qu'il n'ait plus besoin de chercher (max 3 tours).
async function runWebResearch(
  conversation: ChatMessage[],
  preferredProvider?: "local" | "cloud",
): Promise<{ webContext: string; sources: { title: string; url: string }[] }> {
  const recent = conversation.slice(-6);
  // Le fil de la "sous-conversation" de recherche, en format normalisé
  // (callModelWithTools le traduit ensuite pour Ollama ou Mistral).
  const messages: ToolLoopMessage[] = [
    {
      role: "system",
      content:
        'Tu es un assistant de recherche. À partir de la conversation, utilise l\'outil web_search autant de fois que nécessaire pour rassembler les infos factuelles utiles (tu peux chercher plusieurs fois pour creuser un sujet). Quand tu as assez d\'infos — ou si aucune recherche n\'est utile (remerciement, small talk, coaching, reformulation) — réponds juste "FINI" sans appeler d\'outil.',
    },
    ...recent.map((m): ToolLoopMessage => ({ role: m.role, content: m.content })),
  ];

  const collected: { title: string; url: string; content: string; score: number }[] = [];
  // 1 seul tour de recherche = rapide. Passe à 2-3 si tu veux que l'agent creuse
  // en plusieurs recherches successives, au prix de la vitesse (chaque tour = une
  // génération du modèle en plus).
  const MAX_STEPS = 1;

  for (let step = 0; step < MAX_STEPS; step++) {
    // On respecte le choix de l'utilisateur : "local" force le local (pas de
    // bascule cloud cachée), "cloud" force le cloud, et sans choix on laisse
    // callModelWithTools faire son réflexe habituel (Ollama puis cloud en secours).
    const { data: turn, providerLabel } = await callModelWithTools(messages, [WEB_SEARCH_TOOL], {
      forceProvider: preferredProvider,
    });
    if (step === 0) console.log(`[recherche] tool-calling via ${providerLabel}`);
    if (turn.toolCalls.length === 0) break; // le modèle estime avoir fini

    // On rejoue le message de l'assistant (avec ses demandes d'outils) : l'API a
    // besoin de ce lien entre la demande et la réponse d'outil.
    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });

    for (const call of turn.toolCalls) {
      let query = "";
      try {
        query = (JSON.parse(call.arguments) as { query?: string }).query ?? "";
      } catch {
        /* arguments mal formés : on ignore cette demande */
      }
      let toolOutput = "Aucun résultat.";
      if (query) {
        // Visible dans le terminal `npm run dev` : tu vois l'agent chercher, et
        // parfois enchaîner plusieurs recherches au sein d'une même réponse.
        console.log(`[web_search] étape ${step + 1} → "${query}"`);
        const search = await searchWeb(query);
        for (const r of search.results) {
          collected.push({ title: r.title, url: r.url, content: r.content, score: r.score });
        }
        toolOutput =
          search.results.map((r) => `${r.title} — ${r.url}\n${r.content}`).join("\n\n") ||
          "Aucun résultat.";
      }
      // On renvoie le résultat de la recherche au modèle (message de rôle "tool").
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: toolOutput });
    }
  }

  // Dédoublonne les pages par URL (le modèle peut retomber sur les mêmes).
  const seen = new Set<string>();
  const unique = collected.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));

  // On réutilise exactement le même formatage que la recherche simple, pour que
  // les citations [1], [2]... du modèle correspondent à l'ordre de `sources`.
  const webContext = unique.length
    ? formatWebResultsForPrompt({ query: "", answer: null, results: unique })
    : "";
  const sources = unique.map((u) => ({ title: u.title, url: u.url }));
  return { webContext, sources };
}

// "Cerveau" du bouton recherche : à partir de la conversation, le modèle décide
// s'il faut chercher sur le web et, si oui, formule la requête idéale (souvent
// différente de la phrase tapée par l'utilisateur).
// Renvoie la requête à chercher, ou `null` si une recherche est inutile.
async function decideSearchQuery(
  conversation: ChatMessage[],
  forceProvider?: "local" | "cloud",
): Promise<string | null> {
  // On ne donne que les derniers tours : le modèle a juste besoin du sujet du moment.
  const recent = conversation.slice(-6);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`)
    .join("\n");

  const system = `Tu décides s'il faut faire une recherche web pour bien répondre au dernier message.
Une recherche est UTILE pour : chiffres, prix, concurrents, taille de marché, tendances, actualités, faits vérifiables et récents.
Une recherche est INUTILE pour : remerciements, "bonjour", small talk, questions d'opinion ou de coaching, reformulations, ou quand l'historique de la conversation suffit déjà.

Réponds UNIQUEMENT en JSON, sans aucun autre texte :
{ "needSearch": true ou false, "query": "la requête web idéale, courte, formulée comme une recherche Google" }
Si needSearch vaut false, mets "query": "".`;

  try {
    const { data: raw } = await callChatModel(
      [
        { role: "system", content: system },
        { role: "user", content: `Conversation :\n${transcript}\n\nDécide maintenant.` },
      ],
      { jsonMode: true, forceProvider },
    );
    const parsed = JSON.parse(raw) as { needSearch?: boolean; query?: string };
    if (parsed.needSearch && typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim();
    }
    return null;
  } catch {
    // En cas de pépin (JSON cassé, modèle indispo...), on n'enrichit pas : le
    // chat répond normalement, sans web. Une feature de confort ne casse rien.
    return null;
  }
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
