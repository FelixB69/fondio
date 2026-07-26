import { NextResponse } from "next/server";
import {
  AGENTS,
  buildPanelAgentPrompt,
  buildSynthesisSystemPrompt,
  type AgentId,
  type ChatMessage,
  type ProjectType,
} from "@/lib/data";
import { generateArtifacts } from "@/lib/artifacts";
import { buildKnownTermsInstruction, mergeGlossary, type GlossaryEntry } from "@/lib/glossary";
import { callChatModelStream, type LLMMessage } from "@/lib/llm";
import { parseAgentReply } from "@/lib/parse-agent-reply";
import { createClient } from "@/lib/supabase/server";
import { gatherWebContext } from "@/lib/web-search";

export const runtime = "nodejs";

// Borne la taille d'un message utilisateur (cf. /api/chat) : évite de gonfler
// les prompts (N agents + synthèse) et le JSONB de session.
const MAX_MESSAGE_LENGTH = 20_000;

// Orchestration du panel multi-agents EN STREAMING, en UN SEUL appel.
//
// Avant : le client faisait N+1 requêtes séquentielles (une par agent + synthèse),
// chacune relisant ET réécrivant tout le JSONB de session, sans streaming → de
// longs blancs. Désormais : le serveur lit la session une fois, fait répondre les
// agents l'un après l'autre EN STREAMANT chaque token (NDJSON), puis la synthèse,
// et n'écrit en base qu'une fois à la fin (best-effort même en cas d'erreur, pour
// ne pas perdre les réponses déjà produites).
//
// Événements NDJSON émis :
//   { t: "title", title }
//   { t: "agent-start", agentId, provider, providerLabel }
//   { t: "chunk", agentId, c }                      // agentId = "__synthesis__" pour la synthèse
//   { t: "agent-done", agentId, message }
//   { t: "agent-artifacts", agentId, artifacts }
//   { t: "synthesis-start", provider, providerLabel }
//   { t: "synthesis-done", message }
//   { t: "error", error }
//   { t: "done" }

interface PanelChatRequest {
  sessionId: string;
  userMessage: string;
  preferredProvider?: "local" | "cloud";
  webSearch?: boolean;
  challenger?: boolean;
}

export async function POST(req: Request) {
  const { sessionId, userMessage, preferredProvider, webSearch, challenger } =
    (await req.json()) as PanelChatRequest;

  if (!sessionId || !userMessage?.trim()) {
    return NextResponse.json({ error: "sessionId et userMessage requis." }, { status: 400 });
  }
  if (userMessage.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message trop long." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id, project_type, challenger_mode, messages, title, panel_agent_ids, project_id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: "Session introuvable." }, { status: 404 });
  }

  // Les agents du panel viennent de la session (source de vérité), validés.
  const panelIds = (Array.isArray(session.panel_agent_ids) ? session.panel_agent_ids : []).filter(
    (id): id is AgentId => typeof id === "string" && id in AGENTS,
  );
  if (panelIds.length < 2) {
    return NextResponse.json({ error: "Cette session n'est pas un panel valide." }, { status: 400 });
  }

  // Glossaire du projet (termes déjà expliqués) : injecté dans chaque prompt et
  // enrichi des nouveaux termes de ce tour. Idem chat simple.
  let glossary: GlossaryEntry[] = [];
  if (session.project_id) {
    const { data: proj } = await supabase
      .from("projects")
      .select("glossary")
      .eq("id", session.project_id)
      .single();
    glossary = Array.isArray(proj?.glossary) ? (proj!.glossary as GlossaryEntry[]) : [];
  }
  const initialGlossaryLen = glossary.length;
  const knownTermsBlock = buildKnownTermsInstruction(glossary);

  // Contenus de tâches déjà présents (anti-doublon pour les TÂCHES du Chef de projet).
  const existingTaskContents = new Set<string>();
  {
    const { data } = await supabase.from("tasks").select("content").eq("session_id", sessionId);
    for (const t of data ?? []) existingTaskContents.add((t as { content: string }).content);
  }

  const projectType = session.project_type as ProjectType;
  const challengerOn = challenger ?? Boolean(session.challenger_mode);
  const history: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
  const now = new Date().toISOString();

  const userMsg: ChatMessage = { role: "user", content: userMessage.trim(), ts: now };
  const updatedHistory = [...history, userMsg];
  const newTitle =
    (session.title as string | null) ??
    userMsg.content.slice(0, 60) + (userMsg.content.length > 60 ? "…" : "");

  const fullName =
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const firstName = fullName.trim().split(/\s+/)[0] || "";

  // Recherche web partagée : UNE seule recherche, injectée dans le prompt de tous
  // les agents (au lieu de N recherches). Citations [1], [2]… cohérentes.
  let webContext = "";
  let webSources: { title: string; url: string }[] = [];
  if (webSearch) {
    const research = await gatherWebContext(updatedHistory, preferredProvider);
    webContext = research.webContext;
    webSources = research.sources;
  }
  const webFormatReminder = webContext
    ? "\n\nRAPPEL : appuie-toi sur les informations web ci-dessus et cite-les avec [1], [2]… quand tu les utilises."
    : "";

  // Les agents ne voient que les messages UTILISATEUR dans l'historique LLM ; les
  // réponses des autres agents leur sont injectées via le system prompt (débat).
  const userTurns: LLMMessage[] = updatedHistory
    .filter((m) => m.role === "user")
    .map((m) => ({ role: "user" as const, content: m.content }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      // Réponses déjà produites — persistées même si une étape ultérieure plante.
      const agentMsgs: ChatMessage[] = [];
      const previousReplies: Array<{ agentId: AgentId; content: string }> = [];

      const persist = async (msgs: ChatMessage[]) => {
        await supabase
          .from("sessions")
          .update({
            messages: [...updatedHistory, ...msgs],
            title: newTitle,
            challenger_mode: challengerOn,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
      };

      try {
        send({ t: "title", title: newTitle });

        // ── Tour de table des agents ────────────────────────────────────────
        for (let i = 0; i < panelIds.length; i++) {
          const agentId = panelIds[i];
          const isFirstReply = history.length === 0 && i === 0;

          const systemPrompt =
            buildPanelAgentPrompt(
              agentId,
              panelIds,
              previousReplies,
              projectType,
              challengerOn,
              isFirstReply && firstName ? firstName : undefined,
            ) +
            webContext +
            webFormatReminder +
            (knownTermsBlock ? "\n\n" + knownTermsBlock : "");

          const { provider, providerLabel, data: textStream } = await callChatModelStream(
            [{ role: "system", content: systemPrompt }, ...userTurns],
            { forceProvider: preferredProvider },
          );

          send({ t: "agent-start", agentId, provider, providerLabel });

          let raw = "";
          for await (const chunk of textStream) {
            raw += chunk;
            send({ t: "chunk", agentId, c: chunk });
          }

          const parsed = parseAgentReply(raw.trim());
          const agentMsg: ChatMessage = {
            role: "assistant",
            agentId,
            content: parsed.content,
            ts: new Date().toISOString(),
            provider,
            providerLabel,
          };
          if (parsed.deliverables.length) agentMsg.deliverables = parsed.deliverables;
          if (parsed.challenges.length) agentMsg.challenges = parsed.challenges;
          if (webSources.length) agentMsg.sources = webSources;

          // TÂCHES → board (Chef de projet seulement), dédupliquées.
          if (agentId === "pm" && parsed.tasks.length) {
            const fresh = parsed.tasks.filter((t) => !existingTaskContents.has(t));
            if (fresh.length) {
              const { error: taskErr } = await supabase.from("tasks").insert(
                fresh.map((content) => ({
                  user_id: user.id,
                  session_id: sessionId,
                  project_id: session.project_id ?? null,
                  content,
                  status: "todo",
                  source_agent_id: agentId,
                })),
              );
              if (!taskErr) {
                agentMsg.tasks = fresh;
                for (const c of fresh) existingTaskContents.add(c);
              }
            }
          }

          // LEXIQUE → affiché sur le message + fusionné dans le glossaire du projet.
          if (parsed.lexicon.length) {
            agentMsg.lexicon = parsed.lexicon;
            glossary = mergeGlossary(glossary, parsed.lexicon, {
              session_id: sessionId,
              ts: new Date().toISOString(),
            });
          }

          send({ t: "agent-done", agentId, message: agentMsg });

          // 2e passe artefacts (livrables → tableaux/documents).
          if (parsed.deliverables.length) {
            const artifacts = await generateArtifacts({
              conversation: updatedHistory,
              assistantReply: parsed.content,
              deliverableTitles: parsed.deliverables,
              forceProvider: preferredProvider,
            });
            if (artifacts.length) {
              agentMsg.artifacts = artifacts;
              send({ t: "agent-artifacts", agentId, artifacts });
            }
          }

          agentMsgs.push(agentMsg);
          previousReplies.push({ agentId, content: parsed.content });
        }

        // Persiste le glossaire enrichi (une fois, si de nouveaux termes sont apparus).
        if (session.project_id && glossary.length !== initialGlossaryLen) {
          await supabase
            .from("projects")
            .update({ glossary })
            .eq("id", session.project_id);
        }

        // ── Synthèse ────────────────────────────────────────────────────────
        const repliesText = previousReplies
          .map((r) => `--- ${AGENTS[r.agentId].name} ---\n${r.content}`)
          .join("\n\n");

        const synthMessages: LLMMessage[] = [
          { role: "system", content: buildSynthesisSystemPrompt() },
          {
            role: "user",
            content: `Question posée au panel : "${userMsg.content}"\n\nRéponses des experts :\n\n${repliesText}\n\nProduis maintenant ta synthèse.`,
          },
        ];

        const {
          provider: sProvider,
          providerLabel: sLabel,
          data: synthStream,
        } = await callChatModelStream(synthMessages, { forceProvider: preferredProvider });

        send({ t: "synthesis-start", provider: sProvider, providerLabel: sLabel });

        let synthRaw = "";
        for await (const chunk of synthStream) {
          synthRaw += chunk;
          send({ t: "chunk", agentId: "__synthesis__", c: chunk });
        }

        const synthParsed = parseAgentReply(synthRaw.trim());
        const synthesisMsg: ChatMessage = {
          role: "assistant",
          agentId: "__synthesis__",
          content: synthParsed.content,
          ts: new Date().toISOString(),
          provider: sProvider,
          providerLabel: sLabel,
        };
        if (synthParsed.deliverables.length) synthesisMsg.deliverables = synthParsed.deliverables;

        send({ t: "synthesis-done", message: synthesisMsg });

        await persist([...agentMsgs, synthesisMsg]);
        send({ t: "done" });
        controller.close();
      } catch (e: unknown) {
        // Best-effort : on garde les réponses déjà produites pour ne pas tout perdre.
        if (agentMsgs.length) {
          try {
            await persist(agentMsgs);
          } catch {
            /* tant pis */
          }
        }
        send({ t: "error", error: e instanceof Error ? e.message : "Erreur du panel." });
        controller.close();
      }
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
