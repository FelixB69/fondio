"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { marked } from "marked";
import { AGENTS, Agent, AgentId, Artifact, ChatMessage, ProjectType, PROJECT_TYPES, SYNTHESIS_META } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

// ── Types ────────────────────────────────────────────────────────────────────

interface PanelRound {
  userMessage: ChatMessage;
  agentReplies: ChatMessage[];
  synthesis: ChatMessage | null;
}

type AgentLoadStatus = "waiting" | "loading" | "done";

interface AgentLoadState {
  agentId: AgentId | "__synthesis__";
  status: AgentLoadStatus;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupIntoRounds(messages: ChatMessage[], panelAgentIds: AgentId[]): PanelRound[] {
  const rounds: PanelRound[] = [];
  let i = 0;
  while (i < messages.length) {
    if (messages[i].role === "user") {
      const userMessage = messages[i];
      const agentReplies: ChatMessage[] = [];
      let synthesis: ChatMessage | null = null;
      i++;
      while (i < messages.length && messages[i].role === "assistant") {
        if (messages[i].agentId === "__synthesis__") {
          synthesis = messages[i];
        } else {
          agentReplies.push(messages[i]);
        }
        i++;
      }
      rounds.push({ userMessage, agentReplies, synthesis });
    } else {
      i++;
    }
  }
  return rounds;
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Découpe le contenu en phrases et surligne celles qui mentionnent un agent
// du panel (autre que l'auteur) — pour mettre en évidence les répliques croisées.
function renderWithMentions(content: string, refAgents: Agent[]): ReactNode {
  if (!content || refAgents.length === 0) return content;

  const namePattern = refAgents.map((a) => escapeRegex(a.firstName)).join("|");
  const nameRegex = new RegExp(`\\b(${namePattern})\\b`, "i");
  const sentenceMatcher = /[^.!?\n]+(?:[.!?]+|$)/g;

  const out: ReactNode[] = [];
  const paragraphs = content.split("\n");

  paragraphs.forEach((para, paraIdx) => {
    if (paraIdx > 0) out.push(<Fragment key={`nl-${paraIdx}`}>{"\n"}</Fragment>);
    if (!para.trim()) return;

    const sentences = Array.from(para.matchAll(sentenceMatcher), (m) => m[0]);
    const segments = sentences.length > 0 ? sentences : [para];

    segments.forEach((sentence, sIdx) => {
      const match = sentence.match(nameRegex);
      const mentioned = match
        ? refAgents.find((a) => a.firstName.toLowerCase() === match[1].toLowerCase())
        : null;

      if (mentioned) {
        out.push(
          <span
            key={`s-${paraIdx}-${sIdx}`}
            title={`Réponse à ${mentioned.firstName}`}
            style={{
              background: mentioned.bg,
              borderLeft: `2.5px solid ${mentioned.color}`,
              padding: "1px 6px 1px 7px",
              margin: "0 1px",
              borderRadius: "0 4px 4px 0",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            {sentence}
          </span>,
        );
      } else {
        out.push(<Fragment key={`s-${paraIdx}-${sIdx}`}>{sentence}</Fragment>);
      }
    });
  });

  return <>{out}</>;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ArtifactMarkdown({ markdown }: { markdown: string }) {
  const html = marked.parse(markdown, { async: false }) as string;
  return (
    <div
      className="fnd-md"
      style={{
        background: C.white,
        borderRadius: 6,
        padding: "10px 14px",
        fontSize: 13,
        color: C.text,
        lineHeight: 1.6,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ArtifactTable({ headers, rows, color }: { headers: string[]; rows: string[][]; color: string }) {
  return (
    <div style={{ overflowX: "auto", background: C.white, borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: C.text }}>
        <thead>
          <tr style={{ background: `${color}12` }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: "7px 10px", textAlign: "left", fontSize: 11.5, fontWeight: 700, color, borderBottom: `1px solid ${color}28`, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: "6px 10px", verticalAlign: "top", lineHeight: 1.5 }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtifactBlock({ artifact, color, bg }: { artifact: Artifact; color: string; bg: string }) {
  return (
    <div style={{ marginTop: 10, background: bg, border: `1px solid ${color}28`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Icon name={artifact.kind === "table" ? "chart" : "tasks"} size={11} color={color} />
        <div style={{ fontSize: 11.5, fontWeight: 800, color, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {artifact.title}
        </div>
      </div>
      {artifact.kind === "table" ? (
        <ArtifactTable headers={artifact.headers} rows={artifact.rows} color={color} />
      ) : (
        <ArtifactMarkdown markdown={artifact.markdown} />
      )}
    </div>
  );
}

function TypingDots({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color,
              animation: `fndBounce 1.1s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: C.textMute }}>{label} réfléchit…</span>
    </div>
  );
}

function WaitingIndicator({ label }: { label: string }) {
  return (
    <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.border }} />
      <span style={{ fontSize: 11.5, color: C.textMute }}>{label} en attente…</span>
    </div>
  );
}

function AgentReplyBubble({
  msg,
  agentId,
  otherAgents,
}: {
  msg: ChatMessage;
  agentId: AgentId;
  otherAgents: Agent[];
}) {
  const agent = AGENTS[agentId];
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: agent.bg,
          border: `1.5px solid ${agent.color}25`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 12,
          fontWeight: 800,
          color: agent.color,
          fontFamily: "inherit",
          letterSpacing: "-0.02em",
        }}
      >
        {agent.firstName[0]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: agent.color }}>{agent.firstName}</span>
          <span style={{ fontSize: 10.5, color: C.textMute }}>{formatTs(msg.ts)}</span>
        </div>
        <div
          style={{
            background: C.white,
            border: `1px solid ${agent.color}22`,
            borderRadius: "4px 12px 12px 12px",
            padding: "11px 14px",
            boxShadow: C.shadow,
          }}
        >
          <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>
            {renderWithMentions(msg.content, otherAgents)}
          </div>
          {msg.artifacts?.map((a, i) => (
            <ArtifactBlock key={i} artifact={a} color={agent.color} bg={agent.bg} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SynthesisBubble({ msg, panelAgents }: { msg: ChatMessage; panelAgents: Agent[] }) {
  return (
    <div
      style={{
        marginTop: 6,
        background: SYNTHESIS_META.bg,
        border: `1.5px solid ${SYNTHESIS_META.color}40`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: C.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="sparkles" size={16} color={SYNTHESIS_META.color} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: SYNTHESIS_META.color, letterSpacing: "0.02em" }}>
          Synthèse du panel
        </span>
        <span style={{ fontSize: 10.5, color: C.textMute, marginLeft: "auto" }}>{formatTs(msg.ts)}</span>
      </div>
      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>
        {renderWithMentions(msg.content, panelAgents)}
      </div>
      {msg.deliverables && msg.deliverables.length > 0 && (
        <div
          style={{
            marginTop: 10,
            background: `${SYNTHESIS_META.color}10`,
            border: `1px solid ${SYNTHESIS_META.color}25`,
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 800, color: SYNTHESIS_META.color, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
            Recommandations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {msg.deliverables.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                <span style={{ color: SYNTHESIS_META.color, fontWeight: 800, flexShrink: 0 }}>→</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelRoundDisplay({
  round,
  panelAgentIds,
}: {
  round: PanelRound;
  panelAgentIds: AgentId[];
}) {
  const panelAgents = panelAgentIds.map((id) => AGENTS[id]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* User message */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            maxWidth: "72%",
            background: C.navy,
            color: "white",
            borderRadius: "12px 4px 12px 12px",
            padding: "10px 15px",
            fontSize: 13.5,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {round.userMessage.content}
        </div>
      </div>

      {/* Agent replies */}
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {round.agentReplies.map((reply, i) => {
          if (!reply.agentId || reply.agentId === "__synthesis__") return null;
          const speakerId = reply.agentId as AgentId;
          // Pour cet agent : on surligne les mentions des AUTRES agents du panel.
          const others = panelAgents.filter((a) => a.id !== speakerId);
          return (
            <AgentReplyBubble
              key={i}
              msg={reply}
              agentId={speakerId}
              otherAgents={others}
            />
          );
        })}
      </div>

      {/* Synthesis */}
      {round.synthesis && <SynthesisBubble msg={round.synthesis} panelAgents={panelAgents} />}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface MultiAgentSessionProps {
  sessionId: string;
  panelAgentIds: AgentId[];
  projectType: ProjectType;
  initialMessages: ChatMessage[];
  onBack: () => void;
  onTitleChange?: (title: string) => void;
}

export function MultiAgentSession({
  sessionId,
  panelAgentIds,
  projectType,
  initialMessages,
  onBack,
  onTitleChange,
}: MultiAgentSessionProps) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const typeMeta = PROJECT_TYPES[projectType];

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loadStates, setLoadStates] = useState<AgentLoadState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isLoading = loadStates.length > 0;

  useEffect(() => {
    setMessages(initialMessages);
  }, [sessionId, initialMessages]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, loadStates]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    const trimmed = input.trim();
    setInput("");
    setError(null);
    if (taRef.current) taRef.current.style.height = "auto";

    // Affiche immédiatement tous les états de chargement
    const initialLoadStates: AgentLoadState[] = [
      { agentId: panelAgentIds[0], status: "loading" },
      ...panelAgentIds.slice(1).map((id) => ({ agentId: id, status: "waiting" as AgentLoadStatus })),
      { agentId: "__synthesis__", status: "waiting" as AgentLoadStatus },
    ];
    setLoadStates(initialLoadStates);

    const previousReplies: Array<{ agentId: AgentId; content: string }> = [];
    const newMessages: ChatMessage[] = [];

    try {
      // ── Étapes agents ────────────────────────────────────────────────
      for (let step = 0; step < panelAgentIds.length; step++) {
        // Passer l'agent courant en "loading", le suivant en "loading" (si existant)
        setLoadStates((prev) =>
          prev.map((s, i) => {
            if (i === step) return { ...s, status: "done" as AgentLoadStatus };
            if (i === step + 1) return { ...s, status: "loading" as AgentLoadStatus };
            return s;
          }),
        );

        const res = await fetch("/api/panel-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            agentIds: panelAgentIds,
            step,
            previousReplies: [...previousReplies],
            userMessage: step === 0 ? trimmed : undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Erreur inconnue.");
          setLoadStates([]);
          return;
        }

        const agentMsg = data.message as ChatMessage;
        newMessages.push(agentMsg);
        previousReplies.push({ agentId: panelAgentIds[step], content: agentMsg.content });

        // Ajoute le message dans l'UI au fur et à mesure
        setMessages((prev) => {
          const base = step === 0
            ? [...prev, { role: "user" as const, content: trimmed, ts: new Date().toISOString() }]
            : prev;
          return [...base, agentMsg];
        });

        if (step === 0 && data.title && onTitleChange) {
          onTitleChange(data.title);
        }
      }

      // ── Synthèse ────────────────────────────────────────────────────
      setLoadStates((prev) =>
        prev.map((s) =>
          s.agentId === "__synthesis__" ? { ...s, status: "loading" as AgentLoadStatus } : { ...s, status: "done" as AgentLoadStatus },
        ),
      );

      const synthRes = await fetch("/api/panel-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          agentIds: panelAgentIds,
          isSynthesis: true,
          userMessage: trimmed,
          allReplies: previousReplies,
        }),
      });

      const synthData = await synthRes.json();
      if (!synthRes.ok) {
        setError(synthData.error ?? "Erreur lors de la synthèse.");
        setLoadStates([]);
        return;
      }

      setMessages((prev) => [...prev, synthData.message as ChatMessage]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur réseau.");
    } finally {
      setLoadStates([]);
    }
  }, [input, isLoading, sessionId, panelAgentIds, onTitleChange]);

  // Reconstitue les rounds pour l'affichage
  const rounds = groupIntoRounds(messages, panelAgentIds);

  // Trouve les états de chargement en cours pour les afficher dans un "round en cours"
  const currentLoadingAgents = loadStates.filter((s) => s.status !== "done");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg }}>
      {/* Header */}
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          padding: isMobile ? "10px 12px" : "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 8 : 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 6, display: "flex", color: C.textSub }}
          title="Retour"
        >
          <Icon name="arrowLeft" size={16} color={C.textSub} />
        </button>

        {/* Agent avatars */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {panelAgentIds.map((id, i) => (
            <div
              key={id}
              title={`${AGENTS[id].firstName} – ${AGENTS[id].name}`}
              style={{
                width: isMobile ? 26 : 30,
                height: isMobile ? 26 : 30,
                borderRadius: 7,
                background: AGENTS[id].bg,
                border: `2px solid white`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isMobile ? 11 : 12,
                fontWeight: 800,
                color: AGENTS[id].color,
                fontFamily: "inherit",
                letterSpacing: "-0.02em",
                marginLeft: i > 0 ? -8 : 0,
                position: "relative",
                zIndex: panelAgentIds.length - i,
              }}
            >
              {AGENTS[id].firstName[0]}
            </div>
          ))}
          <div
            style={{
              marginLeft: 4,
              width: isMobile ? 26 : 30,
              height: isMobile ? 26 : 30,
              borderRadius: 7,
              background: SYNTHESIS_META.bg,
              border: `2px solid white`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Synthèse"
          >
            <Icon name="sparkles" size={isMobile ? 12 : 14} color={SYNTHESIS_META.color} />
          </div>
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: isMobile ? 12.5 : 14, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Panel · {panelAgentIds.map((id) => AGENTS[id].firstName).join(", ")}
          </div>
          {!isMobile && (
            <div style={{ fontSize: 11.5, color: C.textSub }}>
              {panelAgentIds.length} agents · débat + synthèse
            </div>
          )}
        </div>

        {!isMobile && (
          <span
            style={{
              background: typeMeta.bg,
              color: typeMeta.color,
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: 100,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name={typeMeta.icon as IconName} size={11} color={typeMeta.color} />
            {typeMeta.name}
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: isMobile ? "16px 12px 12px" : "24px 24px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {rounds.length === 0 && !isLoading && (
          <div
            style={{
              color: C.textMute,
              fontSize: 13.5,
              textAlign: "center",
              marginTop: 60,
              maxWidth: 460,
              alignSelf: "center",
              lineHeight: 1.6,
            }}
          >
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {panelAgentIds.map((id) => (
                <div
                  key={id}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: AGENTS[id].bg,
                    border: `1.5px solid ${AGENTS[id].color}25`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    fontWeight: 800,
                    color: AGENTS[id].color,
                    fontFamily: "inherit",
                  }}
                >
                  {AGENTS[id].firstName[0]}
                </div>
              ))}
              <span style={{ fontSize: 20, color: C.textMute }}>→</span>
              <Icon name="sparkles" size={28} color={SYNTHESIS_META.color} />
            </div>
            Pose ta question au panel. Les agents répondront chacun depuis leur angle, se challengeront mutuellement, puis une synthèse consolidera leurs avis.
          </div>
        )}

        {rounds.map((round, i) => (
          <PanelRoundDisplay key={i} round={round} panelAgentIds={panelAgentIds} />
        ))}

        {/* Round en cours (loading) */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Pas de bulle user ici — elle est déjà ajoutée dans messages */}
            <div
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {currentLoadingAgents
                .filter((s) => s.agentId !== "__synthesis__")
                .map((s) => {
                  const agentId = s.agentId as AgentId;
                  const agent = AGENTS[agentId];
                  return (
                    <div
                      key={agentId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 14px",
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: agent.bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 800,
                          color: agent.color,
                          fontFamily: "inherit",
                          flexShrink: 0,
                        }}
                      >
                        {agent.firstName[0]}
                      </div>
                      {s.status === "loading" ? (
                        <TypingDots color={agent.color} label={agent.firstName} />
                      ) : (
                        <WaitingIndicator label={agent.firstName} />
                      )}
                    </div>
                  );
                })}

              {/* Synthesizer */}
              {currentLoadingAgents.some((s) => s.agentId === "__synthesis__") && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    background: `${SYNTHESIS_META.color}08`,
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: SYNTHESIS_META.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="sparkles" size={12} color={SYNTHESIS_META.color} />
                  </div>
                  {loadStates.find((s) => s.agentId === "__synthesis__")?.status === "loading" ? (
                    <TypingDots color={SYNTHESIS_META.color} label={SYNTHESIS_META.name} />
                  ) : (
                    <WaitingIndicator label={SYNTHESIS_META.name} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div />
      </div>

      {error && (
        <div style={{ padding: "8px 20px", background: "#FEF2F2", color: "#991B1B", fontSize: 12.5, borderTop: `1px solid #FECACA` }}>
          {error}
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: isMobile ? "10px 12px 12px" : "12px 20px 16px",
          background: C.white,
          borderTop: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            background: C.bg,
            border: `1.5px solid ${C.border}`,
            borderRadius: 12,
            padding: "10px 14px",
            transition: "border-color 0.15s",
          }}
          onFocusCapture={(e) => (e.currentTarget.style.borderColor = SYNTHESIS_META.color)}
          onBlurCapture={(e) => (e.currentTarget.style.borderColor = C.border)}
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Pose ta question au panel (${panelAgentIds.length} agents + synthèse)…`}
            rows={1}
            disabled={isLoading}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              fontSize: 13.5,
              color: C.text,
              fontFamily: "inherit",
              lineHeight: 1.55,
              maxHeight: 120,
              overflowY: "auto",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              border: "none",
              flexShrink: 0,
              background: input.trim() && !isLoading ? SYNTHESIS_META.color : C.border,
              cursor: input.trim() && !isLoading ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s",
            }}
          >
            <Icon name="send" size={14} color="white" />
          </button>
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: C.textMute, textAlign: "center" }}>
          Entrée pour envoyer · Les agents répondent séquentiellement · Chacun voit les réponses précédentes
        </div>
      </div>
    </div>
  );
}
