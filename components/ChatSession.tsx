"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import {
  AGENTS,
  AgentId,
  Artifact,
  ChatMessage,
  PROJECT_TYPES,
  ProjectType,
  SessionRow,
} from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

const TABLE_DOWNLOAD_FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "json", label: "JSON" },
] as const;

const DOC_DOWNLOAD_FORMATS = [
  { format: "md", label: "Markdown (.md)" },
  { format: "pdf", label: "PDF" },
  { format: "docx", label: "Word (.docx)" },
  { format: "txt", label: "Texte (.txt)" },
] as const;

async function downloadArtifact(artifact: Artifact, format: string): Promise<void> {
  const res = await fetch("/api/artifacts/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact, format }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Téléchargement impossible." }));
    throw new Error(data.error ?? "Téléchargement impossible.");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? `livrable.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ArtifactBlock({
  artifact,
  color,
  bg,
  onConvertToTask,
  tasked,
}: {
  artifact: Artifact;
  color: string;
  bg: string;
  onConvertToTask: (text: string) => void;
  tasked: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formats = artifact.kind === "table" ? TABLE_DOWNLOAD_FORMATS : DOC_DOWNLOAD_FORMATS;

  const handleDownload = async (format: string) => {
    setDownloading(format);
    setError(null);
    try {
      await downloadArtifact(artifact, format);
      setMenuOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Téléchargement impossible.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        background: bg,
        border: `1px solid ${color}28`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Icon name={artifact.kind === "table" ? "chart" : "tasks"} size={11} color={color} />
        <div
          style={{
            flex: 1,
            fontSize: 11.5,
            fontWeight: 800,
            color,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {artifact.title}
        </div>
        <button
          onClick={() => !tasked && onConvertToTask(artifact.title)}
          disabled={tasked}
          title={tasked ? "Déjà ajouté aux tâches" : "Convertir en tâche"}
          style={{
            background: tasked ? "transparent" : C.white,
            color: tasked ? "#0E9F88" : color,
            border: tasked ? "none" : `1px solid ${color}40`,
            borderRadius: 5,
            padding: tasked ? "2px 0" : "3px 8px",
            fontSize: 10.5,
            fontWeight: 700,
            cursor: tasked ? "default" : "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 3,
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
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: C.white,
              color,
              border: `1px solid ${color}40`,
              borderRadius: 5,
              padding: "3px 8px",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Icon name="download" size={9} color={color} />
            Télécharger
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                padding: 4,
                zIndex: 10,
                minWidth: 160,
              }}
            >
              {formats.map((f) => (
                <button
                  key={f.format}
                  onClick={() => handleDownload(f.format)}
                  disabled={downloading !== null}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: "7px 10px",
                    fontSize: 12.5,
                    color: C.text,
                    cursor: downloading !== null ? "wait" : "pointer",
                    fontFamily: "inherit",
                    borderRadius: 5,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {downloading === f.format ? "…" : f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {artifact.kind === "table" ? (
        <ArtifactTable headers={artifact.headers} rows={artifact.rows} color={color} />
      ) : (
        <ArtifactMarkdown markdown={artifact.markdown} />
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#991B1B" }}>{error}</div>
      )}
    </div>
  );
}

function ArtifactTable({
  headers,
  rows,
  color,
}: {
  headers: string[];
  rows: string[][];
  color: string;
}) {
  return (
    <div style={{ overflowX: "auto", background: C.white, borderRadius: 6 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          color: C.text,
        }}
      >
        <thead>
          <tr style={{ background: `${color}12` }}>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  padding: "7px 10px",
                  textAlign: "left",
                  fontSize: 11.5,
                  fontWeight: 700,
                  color,
                  borderBottom: `1px solid ${color}28`,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {r.map((c, j) => (
                <td
                  key={j}
                  style={{
                    padding: "6px 10px",
                    verticalAlign: "top",
                    lineHeight: 1.5,
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

interface ChatSessionProps {
  sessionId: string;
  agentId: AgentId;
  projectType: ProjectType;
  projectId?: string | null;
  initialMessages: ChatMessage[];
  initialChallenger: boolean;
  onBack: () => void;
  onTitleChange?: (title: string) => void;
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function ProviderBadge({
  provider,
  label,
  variant = "compact",
}: {
  provider: "local" | "cloud";
  label?: string;
  variant?: "compact" | "announce";
}) {
  const isCloud = provider === "cloud";
  const color = isCloud ? "#D97706" : "#16A34A";
  const bg = isCloud ? "#FFF7ED" : "#F0FDF4";
  const border = isCloud ? "#FED7AA" : "#BBF7D0";
  const icon = isCloud ? "☁" : "●";
  const text =
    label ?? (isCloud ? "Mistral Cloud" : "Modèle local");

  if (variant === "announce") {
    return (
      <div
        title={
          isCloud
            ? "Ollama local indisponible — bascule automatique sur l'API Mistral (EU)."
            : "Réponse générée par ton modèle Ollama local."
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color,
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 999,
          padding: "3px 9px",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: isCloud ? 12 : 8, lineHeight: 1 }}>{icon}</span>
        {isCloud ? `Réponse via ${text}…` : `Réponse via ${text}…`}
      </div>
    );
  }

  return (
    <span
      title={
        isCloud
          ? "Réponse générée via l'API Mistral (Ollama local était indisponible)."
          : "Réponse générée par ton modèle Ollama local."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        color,
        fontWeight: 600,
        letterSpacing: 0.1,
      }}
    >
      <span style={{ fontSize: isCloud ? 11 : 7, lineHeight: 1 }}>{icon}</span>
      {text}
    </span>
  );
}

function AgentAvatar({ agentId, size = 32 }: { agentId: AgentId; size?: number }) {
  const agent = AGENTS[agentId];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        background: agent.bg,
        border: `1.5px solid ${agent.color}25`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: Math.floor(size * 0.45),
        fontWeight: 800,
        color: agent.color,
        fontFamily: "inherit",
        letterSpacing: "-0.02em",
      }}
    >
      {agent.firstName[0]}
    </div>
  );
}

function TypingDots({ agentId }: { agentId: AgentId }) {
  const color = AGENTS[agentId].color;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AgentAvatar agentId={agentId} size={28} />
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: "4px 12px 12px 12px",
          padding: "12px 16px",
          boxShadow: C.shadow,
        }}
      >
        <div style={{ display: "flex", gap: 5, alignItems: "center", height: 14 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                animation: `fndBounce 1.1s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StructuredBlock({
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
    <div
      style={{
        marginTop: 12,
        background: bg,
        border: `1px solid ${color}28`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
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
            <div
              key={i}
              style={{
                display: "flex",
                gap: 7,
                fontSize: 13,
                color: C.text,
                lineHeight: 1.5,
                alignItems: "flex-start",
              }}
            >
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

function MessageBubble({
  msg,
  agentId,
  onConvertToTask,
  taskedItems,
}: {
  msg: ChatMessage;
  agentId: AgentId;
  onConvertToTask: (text: string) => void;
  taskedItems: Set<string>;
}) {
  if (msg.role === "user") {
    return (
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
          {msg.content}
        </div>
      </div>
    );
  }

  const agent = AGENTS[agentId];
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AgentAvatar agentId={agentId} size={28} />
      <div style={{ flex: 1, maxWidth: "82%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: agent.color }}>{agent.firstName}</span>
          <span style={{ fontSize: 11, color: C.textMute }}>{formatTs(msg.ts)}</span>
          {msg.provider && (
            <>
              <span style={{ fontSize: 10, color: C.textMute }}>·</span>
              <ProviderBadge provider={msg.provider} label={msg.providerLabel} />
            </>
          )}
        </div>
        <div
          style={{
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: "4px 12px 12px 12px",
            padding: "13px 16px",
            boxShadow: C.shadow,
          }}
        >
          <div
            style={{
              fontSize: 13.5,
              color: C.text,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
            }}
          >
            {msg.content}
          </div>
          {msg.artifacts && msg.artifacts.length > 0
            ? msg.artifacts.map((a, i) => (
                <ArtifactBlock
                  key={i}
                  artifact={a}
                  color={agent.color}
                  bg={agent.bg}
                  onConvertToTask={onConvertToTask}
                  tasked={taskedItems.has(a.title)}
                />
              ))
            : (
              <StructuredBlock
                label="Livrables"
                icon="tasks"
                items={msg.deliverables ?? []}
                color={agent.color}
                bg={agent.bg}
                onConvertToTask={onConvertToTask}
                taskedItems={taskedItems}
              />
            )}
          <StructuredBlock
            label="⚡ Questions difficiles"
            icon="zap"
            items={msg.challenges ?? []}
            color="#D97706"
            bg="#FFFBEB"
          />
        </div>
      </div>
    </div>
  );
}

export function ChatSession({
  sessionId,
  agentId,
  projectType,
  projectId,
  initialMessages,
  initialChallenger,
  onBack,
  onTitleChange,
}: ChatSessionProps) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const agent = AGENTS[agentId];
  const typeMeta = PROJECT_TYPES[projectType];

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingProvider, setStreamingProvider] = useState<"local" | "cloud" | null>(null);
  const [streamingProviderLabel, setStreamingProviderLabel] = useState<string | undefined>(undefined);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [challenger, setChallenger] = useState(initialChallenger);
  const [error, setError] = useState<string | null>(null);
  const [taskedItems, setTaskedItems] = useState<Set<string>>(new Set());

  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
    setChallenger(initialChallenger);
  }, [sessionId, initialMessages, initialChallenger]);

  // Pré-remplit le badge "déjà tâche" avec les livrables qui sont déjà des tasks
  // pour cette session — comme ça on ne peut pas créer de doublons.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tasks")
        .select("content")
        .eq("session_id", sessionId);
      if (cancelled || !data) return;
      setTaskedItems(new Set(data.map((t: { content: string }) => t.content)));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, supabase]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, loading, streamingContent]);

  const convertToTask = useCallback(
    async (text: string) => {
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
    [agentId, sessionId, supabase, taskedItems],
  );

  const toggleChallenger = useCallback(async () => {
    const next = !challenger;
    setChallenger(next);
    await supabase.from("sessions").update({ challenger_mode: next }).eq("id", sessionId);
  }, [challenger, sessionId, supabase, projectId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    const trimmed = input.trim();
    setInput("");
    setError(null);
    if (taRef.current) taRef.current.style.height = "auto";

    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      ts: new Date().toISOString(),
    };
    setMessages((p) => [...p, userMsg]);
    setLoading(true);
    setStreamingContent("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: trimmed }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Erreur réseau." }));
        setError(data.error ?? "Erreur inconnue.");
        setMessages((p) => p.slice(0, -1));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let rolledBack = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          let evt: {
            t: string;
            c?: string;
            assistant?: ChatMessage;
            title?: string;
            artifacts?: ChatMessage["artifacts"];
            error?: string;
            provider?: "local" | "cloud";
            providerLabel?: string;
          };
          try {
            evt = JSON.parse(trimmedLine);
          } catch {
            continue;
          }
          if (evt.t === "provider" && evt.provider) {
            setStreamingProvider(evt.provider);
            setStreamingProviderLabel(evt.providerLabel);
          } else if (evt.t === "chunk" && typeof evt.c === "string") {
            setStreamingContent((s) => s + evt.c);
          } else if (evt.t === "text-done" && evt.assistant) {
            const assistant = evt.assistant;
            setMessages((p) => [...p, assistant]);
            setStreamingContent("");
            setStreamingProvider(null);
            setStreamingProviderLabel(undefined);
            if (assistant.deliverables?.length) setLoadingArtifacts(true);
            if (evt.title && onTitleChange) onTitleChange(evt.title);
          } else if (evt.t === "artifacts" && evt.artifacts) {
            const artifacts = evt.artifacts;
            setMessages((p) => {
              if (!p.length) return p;
              const last = p[p.length - 1];
              if (last.role !== "assistant") return p;
              return [...p.slice(0, -1), { ...last, artifacts }];
            });
            setLoadingArtifacts(false);
          } else if (evt.t === "done") {
            setLoadingArtifacts(false);
          } else if (evt.t === "error") {
            setError(evt.error ?? "Erreur inconnue.");
            if (!rolledBack) {
              setMessages((p) => p.slice(0, -1));
              rolledBack = true;
            }
            setStreamingContent("");
            setStreamingProvider(null);
            setStreamingProviderLabel(undefined);
            setLoadingArtifacts(false);
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur réseau.");
      setMessages((p) => p.slice(0, -1));
      setStreamingContent("");
      setStreamingProvider(null);
      setStreamingProviderLabel(undefined);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, onTitleChange]);

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
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 6,
            borderRadius: 6,
            display: "flex",
            color: C.textSub,
          }}
          title="Retour aux agents"
        >
          <Icon name="arrowLeft" size={16} color={C.textSub} />
        </button>

        <AgentAvatar agentId={agentId} size={isMobile ? 28 : 34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: isMobile ? 13 : 14.5, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            {agent.firstName}
          </div>
          {!isMobile && <div style={{ fontSize: 11.5, color: C.textSub }}>{agent.name} · {agent.desc}</div>}
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

        <button
          onClick={toggleChallenger}
          title="Pousse l'agent à challenger tes hypothèses"
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 0 : 7,
            border: `1.5px solid ${challenger ? "#D97706" : C.border}`,
            background: challenger ? "#FFFBEB" : C.white,
            color: challenger ? "#D97706" : C.textSub,
            borderRadius: 100,
            padding: isMobile ? "6px" : "5px 11px 5px 9px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          <Icon name="zap" size={12} color={challenger ? "#D97706" : C.textSub} />
          {!isMobile && (
            <>
              Mode Challenger
              <span
                style={{
                  width: 26,
                  height: 14,
                  borderRadius: 100,
                  background: challenger ? "#D97706" : C.border,
                  position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: challenger ? 14 : 2,
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
          gap: 14,
        }}
      >
        {messages.length === 0 && !loading && (
          <div
            style={{
              color: C.textMute,
              fontSize: 13.5,
              textAlign: "center",
              marginTop: 60,
              maxWidth: 420,
              alignSelf: "center",
              lineHeight: 1.6,
            }}
          >
            Dis à <strong style={{ color: agent.color }}>{agent.firstName}</strong> sur quoi tu veux travailler aujourd'hui.
            <br />
            Plus tu donnes de contexte, plus la session sera utile.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            agentId={agentId}
            onConvertToTask={convertToTask}
            taskedItems={taskedItems}
          />
        ))}
        {streamingProvider === "cloud" && (
          <div style={{ paddingLeft: 38 }}>
            <ProviderBadge
              provider="cloud"
              label={streamingProviderLabel}
              variant="announce"
            />
          </div>
        )}
        {streamingContent && (
          <MessageBubble
            msg={{
              role: "assistant",
              // On coupe à LIVRABLES:/CHALLENGES: pour ne pas montrer la
              // section structurée en texte brut pendant le streaming —
              // elle sera rendue proprement au `text-done`.
              content: streamingContent.split(/\n\s*(?:LIVRABLES|CHALLENGES)\s*:/i)[0],
              ts: new Date().toISOString(),
              provider: streamingProvider ?? undefined,
              providerLabel: streamingProviderLabel,
            }}
            agentId={agentId}
            onConvertToTask={convertToTask}
            taskedItems={taskedItems}
          />
        )}
        {loading && !streamingContent && !loadingArtifacts && <TypingDots agentId={agentId} />}
        {loadingArtifacts && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", paddingLeft: 38 }}>
            <div
              style={{
                fontSize: 12,
                color: agent.color,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: agent.color,
                  animation: "fndBounce 1.1s ease-in-out infinite",
                  opacity: 0.7,
                }}
              />
              Chargement des livrables en cours…
            </div>
          </div>
        )}
        <div />
      </div>

      {error && (
        <div
          style={{
            padding: "8px 20px",
            background: "#FEF2F2",
            color: "#991B1B",
            fontSize: 12.5,
            borderTop: `1px solid #FECACA`,
          }}
        >
          {error}
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
          onFocusCapture={(e) => (e.currentTarget.style.borderColor = agent.color)}
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
            placeholder={`Pose ta question à ${agent.firstName}…`}
            rows={1}
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
            disabled={!input.trim() || loading}
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              border: "none",
              flexShrink: 0,
              background: input.trim() && !loading ? agent.color : C.border,
              cursor: input.trim() && !loading ? "pointer" : "default",
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
          Entrée pour envoyer · Shift+Entrée pour saut de ligne · Llama3 + Qwen2.5-Coder (livrables)
        </div>
      </div>
    </div>
  );
}

export type { ChatSessionProps, SessionRow };
