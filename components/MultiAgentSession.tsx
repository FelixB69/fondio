"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AGENTS,
  Agent,
  AgentId,
  ChatMessage,
  ProjectType,
  PROJECT_TYPES,
  SYNTHESIS_META,
} from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { type ModelProvider, type ModelStatus } from "@/lib/models";
import { stripTrailingSections } from "@/lib/parse-agent-reply";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import type { ProjectLite } from "./AppDataProvider";
import { ArtifactBlock } from "./Artifact";
import { Icon, IconName } from "./Icon";
import { ModelSelector } from "./ModelSelector";
import { ProjectLinkButton } from "./ProjectLinkButton";

// ── Types ────────────────────────────────────────────────────────────────────

interface PanelRound {
  userMessage: ChatMessage;
  agentReplies: ChatMessage[];
  synthesis: ChatMessage | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupIntoRounds(messages: ChatMessage[]): PanelRound[] {
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

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

function ProviderBadge({ provider, label }: { provider: "local" | "cloud" | "byok"; label?: string }) {
  const isCloud = provider === "cloud";
  const PROVIDER_STYLES = {
    local: { color: "#16A34A", icon: "●", defaultText: "Modèle local" },
    cloud: { color: "#D97706", icon: "☁", defaultText: "Mistral Cloud" },
    byok: { color: "#7C3AED", icon: "🔑", defaultText: "Votre clé" },
  } as const;
  const { color, icon, defaultText } = PROVIDER_STYLES[provider];
  const text = label ?? defaultText;
  const title =
    provider === "byok"
      ? "Réponse générée avec votre clé API personnelle (BYOK)."
      : isCloud
        ? "Réponse générée via l'API Mistral (Ollama local était indisponible)."
        : "Réponse générée par votre modèle Ollama local.";
  return (
    <span
      title={title}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color, fontWeight: 600 }}
    >
      <span style={{ fontSize: isCloud ? 11 : 7, lineHeight: 1 }}>{icon}</span>
      {text}
    </span>
  );
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard refusé */
        }
      }}
      title="Copier"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        background: "transparent",
        border: "none",
        color: copied ? "#0E9F88" : C.textMute,
        fontSize: 10.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        padding: "0 2px",
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={10} color={copied ? "#0E9F88" : C.textMute} />
      {copied ? "Copié" : "Copier"}
    </button>
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

function SourcesBlock({ sources }: { sources?: { title: string; url: string }[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textMute }}>Sources :</span>
      {sources.map((s, i) => (
        <a
          key={i}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title}
          style={{
            fontSize: 11,
            color: C.navy,
            background: C.navyLight,
            borderRadius: 6,
            padding: "2px 8px",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {i + 1}. {hostname(s.url)}
        </a>
      ))}
    </div>
  );
}

// Liste de livrables/challenges avec bouton « convertir en tâche ».
function DeliverablesBlock({
  label,
  icon,
  items,
  color,
  bg,
  onConvertToTask,
  taskedItems,
}: {
  label: string;
  icon: IconName;
  items: string[];
  color: string;
  bg: string;
  onConvertToTask?: (text: string) => void;
  taskedItems?: Set<string>;
}) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 10, background: bg, border: `1px solid ${color}28`, borderRadius: 8, padding: "10px 12px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10.5,
          fontWeight: 800,
          color,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        <Icon name={icon} size={11} color={color} />
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {items.map((item, i) => {
          const tasked = taskedItems?.has(item);
          return (
            <div key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: C.text, lineHeight: 1.5, alignItems: "flex-start" }}>
              <span style={{ color, fontWeight: 800, flexShrink: 0 }}>→</span>
              <span style={{ flex: 1 }}>{item}</span>
              {onConvertToTask && (
                <button
                  onClick={() => !tasked && onConvertToTask(item)}
                  disabled={tasked}
                  title={tasked ? "Déjà ajouté aux tâches" : "Convertir en tâche"}
                  style={{
                    background: tasked ? "transparent" : C.white,
                    color: tasked ? "#0E9F88" : color,
                    border: tasked ? "none" : `1px solid ${color}40`,
                    borderRadius: 5,
                    padding: tasked ? "2px 0" : "2px 7px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: tasked ? "default" : "pointer",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {tasked ? (
                    <>
                      <Icon name="check" size={9} color="#0E9F88" /> Tâche
                    </>
                  ) : (
                    <>
                      <Icon name="plus" size={9} color={color} /> Tâche
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentReplyBubble({
  msg,
  agentId,
  otherAgents,
  onConvertToTask,
  taskedItems,
  streaming = false,
}: {
  msg: ChatMessage;
  agentId: AgentId;
  otherAgents: Agent[];
  onConvertToTask?: (text: string, agentId: AgentId) => void;
  taskedItems?: Set<string>;
  streaming?: boolean;
}) {
  const agent = AGENTS[agentId];
  const convert = onConvertToTask ? (text: string) => onConvertToTask(text, agentId) : undefined;
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: agent.color }}>{agent.firstName}</span>
          {!streaming && <span style={{ fontSize: 10.5, color: C.textMute }}>{formatTs(msg.ts)}</span>}
          {msg.provider && (
            <>
              <span style={{ fontSize: 10, color: C.textMute }}>·</span>
              <ProviderBadge provider={msg.provider} label={msg.providerLabel} />
            </>
          )}
          {!streaming && msg.content && (
            <span style={{ marginLeft: "auto" }}>
              <CopyButton content={msg.content} />
            </span>
          )}
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
            {streaming && <span className="fnd-caret">▍</span>}
          </div>
          {msg.artifacts && msg.artifacts.length > 0 ? (
            msg.artifacts.map((a, i) => (
              <ArtifactBlock
                key={i}
                artifact={a}
                color={agent.color}
                bg={agent.bg}
                onConvertToTask={convert}
                tasked={taskedItems?.has(a.title)}
              />
            ))
          ) : (
            <DeliverablesBlock
              label="Livrables"
              icon="tasks"
              items={msg.deliverables ?? []}
              color={agent.color}
              bg={agent.bg}
              onConvertToTask={convert}
              taskedItems={taskedItems}
            />
          )}
          <DeliverablesBlock
            label="⚡ Questions difficiles"
            icon="zap"
            items={msg.challenges ?? []}
            color="#D97706"
            bg="#FFFBEB"
          />
          <SourcesBlock sources={msg.sources} />
        </div>
      </div>
    </div>
  );
}

function SynthesisBubble({
  msg,
  panelAgents,
  onConvertToTask,
  taskedItems,
  streaming = false,
}: {
  msg: ChatMessage;
  panelAgents: Agent[];
  onConvertToTask?: (text: string) => void;
  taskedItems?: Set<string>;
  streaming?: boolean;
}) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Icon name="sparkles" size={16} color={SYNTHESIS_META.color} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: SYNTHESIS_META.color, letterSpacing: "0.02em" }}>
          Synthèse du panel
        </span>
        {msg.provider && (
          <>
            <span style={{ fontSize: 10, color: C.textMute }}>·</span>
            <ProviderBadge provider={msg.provider} label={msg.providerLabel} />
          </>
        )}
        {!streaming && (
          <span style={{ fontSize: 10.5, color: C.textMute, marginLeft: "auto" }}>{formatTs(msg.ts)}</span>
        )}
        {!streaming && msg.content && <CopyButton content={msg.content} />}
      </div>
      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>
        {renderWithMentions(msg.content, panelAgents)}
        {streaming && <span className="fnd-caret">▍</span>}
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
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              color: SYNTHESIS_META.color,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Recommandations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {msg.deliverables.map((d, i) => {
              const tasked = taskedItems?.has(d);
              return (
                <div key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: C.text, lineHeight: 1.5, alignItems: "flex-start" }}>
                  <span style={{ color: SYNTHESIS_META.color, fontWeight: 800, flexShrink: 0 }}>→</span>
                  <span style={{ flex: 1 }}>{d}</span>
                  {onConvertToTask && (
                    <button
                      onClick={() => !tasked && onConvertToTask(d)}
                      disabled={tasked}
                      title={tasked ? "Déjà ajouté aux tâches" : "Convertir en tâche"}
                      style={{
                        background: tasked ? "transparent" : C.white,
                        color: tasked ? "#0E9F88" : SYNTHESIS_META.color,
                        border: tasked ? "none" : `1px solid ${SYNTHESIS_META.color}40`,
                        borderRadius: 5,
                        padding: tasked ? "2px 0" : "2px 7px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: tasked ? "default" : "pointer",
                        fontFamily: "inherit",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {tasked ? (
                        <>
                          <Icon name="check" size={9} color="#0E9F88" /> Tâche
                        </>
                      ) : (
                        <>
                          <Icon name="plus" size={9} color={SYNTHESIS_META.color} /> Tâche
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelRoundDisplay({
  round,
  panelAgentIds,
  onConvertToTask,
  taskedItems,
}: {
  round: PanelRound;
  panelAgentIds: AgentId[];
  onConvertToTask: (text: string, agentId: AgentId) => void;
  taskedItems: Set<string>;
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
          const others = panelAgents.filter((a) => a.id !== speakerId);
          return (
            <AgentReplyBubble
              key={i}
              msg={reply}
              agentId={speakerId}
              otherAgents={others}
              onConvertToTask={onConvertToTask}
              taskedItems={taskedItems}
            />
          );
        })}
      </div>

      {/* Synthesis */}
      {round.synthesis && (
        <SynthesisBubble
          msg={round.synthesis}
          panelAgents={panelAgents}
          onConvertToTask={(text) => onConvertToTask(text, panelAgentIds[0])}
          taskedItems={taskedItems}
        />
      )}
    </div>
  );
}

// Bouton pilule réutilisable (Challenger / Recherche web).
function HeaderToggle({
  active,
  onClick,
  icon,
  label,
  colorOn,
  bgOn,
  title,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  icon: IconName;
  label: string;
  colorOn: string;
  bgOn: string;
  title: string;
  compact: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 0 : 7,
        border: `1.5px solid ${active ? colorOn : C.border}`,
        background: active ? bgOn : C.white,
        color: active ? colorOn : C.textSub,
        borderRadius: 100,
        padding: compact ? "6px" : "5px 11px 5px 9px",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "inherit",
        transition: "all 0.15s",
      }}
    >
      <Icon name={icon} size={12} color={active ? colorOn : C.textSub} />
      {!compact && (
        <>
          {label}
          <span
            style={{
              width: 26,
              height: 14,
              borderRadius: 100,
              background: active ? colorOn : C.border,
              position: "relative",
              transition: "background 0.2s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: active ? 14 : 2,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "white",
                transition: "left 0.2s",
              }}
            />
          </span>
        </>
      )}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface MultiAgentSessionProps {
  sessionId: string;
  panelAgentIds: AgentId[];
  projectType: ProjectType;
  projectId?: string | null;
  project?: ProjectLite | null;
  initialMessages: ChatMessage[];
  initialChallenger?: boolean;
  onBack: () => void;
  onTitleChange?: (title: string) => void;
  onLinkProject?: () => void;
}

export function MultiAgentSession({
  sessionId,
  panelAgentIds,
  projectType,
  project = null,
  initialMessages,
  initialChallenger = false,
  onBack,
  onTitleChange,
  onLinkProject,
}: MultiAgentSessionProps) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const typeMeta = PROJECT_TYPES[projectType];
  const panelAgents = panelAgentIds.map((id) => AGENTS[id]);

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Réglages partagés avec le chat simple.
  const [preferredProvider, setPreferredProvider] = useState<ModelProvider>("cloud");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [challenger, setChallenger] = useState(initialChallenger);
  const [webSearch, setWebSearch] = useState(false);
  const [taskedItems, setTaskedItems] = useState<Set<string>>(new Set());

  // État du round en cours de streaming.
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveUser, setLiveUser] = useState<string | null>(null);
  const [liveReplies, setLiveReplies] = useState<ChatMessage[]>([]);
  const [liveSynthesis, setLiveSynthesis] = useState<ChatMessage | null>(null);
  const [streamingAgentId, setStreamingAgentId] = useState<AgentId | "__synthesis__" | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingProvider, setStreamingProvider] = useState<"local" | "cloud" | null>(null);
  const [streamingProviderLabel, setStreamingProviderLabel] = useState<string | undefined>(undefined);

  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
    setChallenger(initialChallenger);
  }, [sessionId, initialMessages, initialChallenger]);

  const refreshStatus = useCallback(async (selectLocalIfUp = true) => {
    setStatusRefreshing(true);
    try {
      const r = await fetch("/api/ollama-status");
      const data = (await r.json()) as ModelStatus;
      setModelStatus(data);
      if (data.available && selectLocalIfUp) setPreferredProvider("local");
    } catch {
      setModelStatus((prev) => (prev ? { ...prev, available: false } : prev));
    } finally {
      setStatusRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Pré-remplit les livrables déjà transformés en tâches (anti-doublon).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tasks").select("content").eq("session_id", sessionId);
      if (cancelled || !data) return;
      setTaskedItems(new Set(data.map((t: { content: string }) => t.content)));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, supabase]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, liveReplies, liveSynthesis, streamingContent, isStreaming]);

  const convertToTask = useCallback(
    async (text: string, agentId: AgentId) => {
      if (taskedItems.has(text)) return;
      setTaskedItems((p) => new Set(p).add(text));
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: sess } = await supabase
        .from("sessions")
        .select("project_id")
        .eq("id", sessionId)
        .single();
      await supabase.from("tasks").insert({
        user_id: user.id,
        session_id: sessionId,
        project_id: sess?.project_id ?? null,
        content: text,
        status: "todo",
        source_agent_id: agentId,
      });
    },
    [sessionId, supabase, taskedItems],
  );

  const toggleChallenger = useCallback(async () => {
    const next = !challenger;
    setChallenger(next);
    await supabase.from("sessions").update({ challenger_mode: next }).eq("id", sessionId);
  }, [challenger, sessionId, supabase]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const trimmed = input.trim();
    setInput("");
    setError(null);
    if (taRef.current) taRef.current.style.height = "auto";

    const userMsg: ChatMessage = { role: "user", content: trimmed, ts: new Date().toISOString() };

    setLiveUser(trimmed);
    setLiveReplies([]);
    setLiveSynthesis(null);
    setStreamingAgentId(null);
    setStreamingContent("");
    setStreamingProvider(null);
    setStreamingProviderLabel(undefined);
    setIsStreaming(true);

    // Sources de vérité locales (immunisées contre les setState asynchrones).
    const collectedReplies: ChatMessage[] = [];
    let collectedSynthesis: ChatMessage | null = null;
    let hadError = false;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/panel-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: trimmed, preferredProvider, webSearch, challenger }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Erreur réseau." }));
        setError(data.error ?? "Erreur inconnue.");
        hadError = true;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let evt: {
            t: string;
            c?: string;
            agentId?: AgentId | "__synthesis__";
            message?: ChatMessage;
            artifacts?: ChatMessage["artifacts"];
            title?: string;
            provider?: "local" | "cloud";
            providerLabel?: string;
            error?: string;
          };
          try {
            evt = JSON.parse(t);
          } catch {
            continue;
          }

          if (evt.t === "title") {
            if (evt.title && onTitleChange) onTitleChange(evt.title);
          } else if (evt.t === "agent-start") {
            setStreamingAgentId(evt.agentId ?? null);
            setStreamingProvider(evt.provider ?? null);
            setStreamingProviderLabel(evt.providerLabel);
            setStreamingContent("");
          } else if (evt.t === "chunk" && typeof evt.c === "string") {
            setStreamingContent((s) => s + evt.c);
          } else if (evt.t === "agent-done" && evt.message) {
            collectedReplies.push(evt.message);
            setLiveReplies([...collectedReplies]);
            setStreamingContent("");
            setStreamingAgentId(null);
          } else if (evt.t === "agent-artifacts" && evt.artifacts && evt.agentId) {
            const idx = collectedReplies.findLastIndex((m) => m.agentId === evt.agentId);
            if (idx >= 0) {
              collectedReplies[idx] = { ...collectedReplies[idx], artifacts: evt.artifacts };
              setLiveReplies([...collectedReplies]);
            }
          } else if (evt.t === "synthesis-start") {
            setStreamingAgentId("__synthesis__");
            setStreamingProvider(evt.provider ?? null);
            setStreamingProviderLabel(evt.providerLabel);
            setStreamingContent("");
          } else if (evt.t === "synthesis-done" && evt.message) {
            collectedSynthesis = evt.message;
            setLiveSynthesis(evt.message);
            setStreamingContent("");
            setStreamingAgentId(null);
          } else if (evt.t === "error") {
            setError(evt.error ?? "Erreur du panel.");
            hadError = true;
          }
        }
      }
    } catch (e: unknown) {
      // Stop volontaire : pas d'erreur affichée, on garde le déjà-produit.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Erreur réseau.");
        hadError = true;
      }
    } finally {
      // Bascule le round terminé dans l'historique. On garde ce qu'on a si erreur
      // (le serveur l'a aussi persisté), sinon on jette un round vide.
      setMessages((prev) => {
        if (collectedReplies.length === 0) return prev;
        return [
          ...prev,
          userMsg,
          ...collectedReplies,
          ...(collectedSynthesis ? [collectedSynthesis] : []),
        ];
      });
      setIsStreaming(false);
      setLiveUser(null);
      setLiveReplies([]);
      setLiveSynthesis(null);
      setStreamingAgentId(null);
      setStreamingContent("");
      setStreamingProvider(null);
      setStreamingProviderLabel(undefined);
      abortRef.current = null;
      void hadError;
    }
  }, [input, isStreaming, sessionId, preferredProvider, webSearch, challenger, onTitleChange]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const rounds = groupIntoRounds(messages);

  // Agents pas encore passés dans le round live (ni terminés, ni en cours).
  const doneAgentIds = new Set(liveReplies.map((r) => r.agentId));
  const allAgentsDone = liveReplies.length === panelAgentIds.length;

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

        {onLinkProject && <ProjectLinkButton project={project} isMobile={isMobile} onClick={onLinkProject} />}

        <HeaderToggle
          active={challenger}
          onClick={toggleChallenger}
          icon="zap"
          label="Mode Challenger"
          colorOn="#D97706"
          bgOn="#FFFBEB"
          title="Pousse les agents à challenger vos hypothèses"
          compact={isMobile}
        />
        <HeaderToggle
          active={webSearch}
          onClick={() => setWebSearch((v) => !v)}
          icon="search"
          label="Recherche web"
          colorOn="#0284C7"
          bgOn="#E0F2FE"
          title="Les agents consultent le web avant de répondre (plus lent)"
          compact={isMobile}
        />
        <ModelSelector
          status={modelStatus}
          provider={preferredProvider}
          onChange={setPreferredProvider}
          onRefresh={() => refreshStatus()}
          refreshing={statusRefreshing}
          compact={isMobile}
        />
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
        {rounds.length === 0 && !isStreaming && (
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
            Posez votre question au panel. Les agents répondront chacun depuis leur angle, se
            challengeront mutuellement, puis une synthèse consolidera leurs avis.
          </div>
        )}

        {rounds.map((round, i) => (
          <PanelRoundDisplay
            key={i}
            round={round}
            panelAgentIds={panelAgentIds}
            onConvertToTask={convertToTask}
            taskedItems={taskedItems}
          />
        ))}

        {/* Round en cours (streaming) */}
        {isStreaming && liveUser && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                {liveUser}
              </div>
            </div>

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
              {/* Réponses déjà terminées */}
              {liveReplies.map((reply, i) => {
                const speakerId = reply.agentId as AgentId;
                const others = panelAgents.filter((a) => a.id !== speakerId);
                return (
                  <AgentReplyBubble
                    key={`done-${i}`}
                    msg={reply}
                    agentId={speakerId}
                    otherAgents={others}
                    onConvertToTask={convertToTask}
                    taskedItems={taskedItems}
                  />
                );
              })}

              {/* Agent en cours de génération */}
              {streamingAgentId && streamingAgentId !== "__synthesis__" && (
                streamingContent ? (
                  <AgentReplyBubble
                    msg={{
                      role: "assistant",
                      agentId: streamingAgentId,
                      content: stripTrailingSections(streamingContent),
                      ts: new Date().toISOString(),
                      provider: streamingProvider ?? undefined,
                      providerLabel: streamingProviderLabel,
                    }}
                    agentId={streamingAgentId}
                    otherAgents={panelAgents.filter((a) => a.id !== streamingAgentId)}
                    streaming
                  />
                ) : (
                  <TypingDots color={AGENTS[streamingAgentId].color} label={AGENTS[streamingAgentId].firstName} />
                )
              )}

              {/* Agents pas encore passés */}
              {panelAgentIds
                .filter((id) => !doneAgentIds.has(id) && id !== streamingAgentId)
                .map((id) => (
                  <WaitingIndicator key={`wait-${id}`} label={AGENTS[id].firstName} />
                ))}
            </div>

            {/* Synthèse en cours / à venir */}
            {liveSynthesis ? (
              <SynthesisBubble
                msg={liveSynthesis}
                panelAgents={panelAgents}
                onConvertToTask={(text) => convertToTask(text, panelAgentIds[0])}
                taskedItems={taskedItems}
              />
            ) : streamingAgentId === "__synthesis__" ? (
              streamingContent ? (
                <SynthesisBubble
                  msg={{
                    role: "assistant",
                    agentId: "__synthesis__",
                    content: stripTrailingSections(streamingContent),
                    ts: new Date().toISOString(),
                    provider: streamingProvider ?? undefined,
                    providerLabel: streamingProviderLabel,
                  }}
                  panelAgents={panelAgents}
                  streaming
                />
              ) : (
                <div
                  style={{
                    background: `${SYNTHESIS_META.color}08`,
                    border: `1px solid ${SYNTHESIS_META.color}25`,
                    borderRadius: 12,
                  }}
                >
                  <TypingDots color={SYNTHESIS_META.color} label={SYNTHESIS_META.name} />
                </div>
              )
            ) : (
              allAgentsDone && (
                <div
                  style={{
                    background: `${SYNTHESIS_META.color}08`,
                    border: `1px solid ${SYNTHESIS_META.color}25`,
                    borderRadius: 12,
                  }}
                >
                  <WaitingIndicator label={SYNTHESIS_META.name} />
                </div>
              )
            )}
          </div>
        )}

        <div />
      </div>

      {error && (
        <div style={{ padding: "8px 20px", background: "#FEF2F2", color: "#991B1B", fontSize: 12.5, borderTop: `1px solid #FECACA` }}>
          {error}
        </div>
      )}

      {webSearch && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 20px",
            background: "#F0F9FF",
            color: "#0369A1",
            fontSize: 11.5,
            fontWeight: 600,
            borderTop: `1px solid #E0F2FE`,
          }}
        >
          <Icon name="search" size={12} color="#0EA5E9" />
          Recherche web activée : une recherche partagée enrichit tous les agents, les réponses sont
          plus lentes.
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: isMobile ? "10px 12px calc(12px + env(safe-area-inset-bottom))" : "12px 20px 16px",
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
            placeholder={`Posez votre question au panel (${panelAgentIds.length} agents + synthèse)…`}
            rows={1}
            disabled={isStreaming}
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
          {isStreaming ? (
            <button
              onClick={handleStop}
              title="Arrêter le panel"
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                border: "none",
                flexShrink: 0,
                background: "#991B1B",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 2, background: "white" }} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                border: "none",
                flexShrink: 0,
                background: input.trim() ? SYNTHESIS_META.color : C.border,
                cursor: input.trim() ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s",
              }}
            >
              <Icon name="send" size={14} color="white" />
            </button>
          )}
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: C.textMute, textAlign: "center" }}>
          Entrée pour envoyer · Les agents répondent en direct, chacun voit les précédents
        </div>
      </div>
    </div>
  );
}
