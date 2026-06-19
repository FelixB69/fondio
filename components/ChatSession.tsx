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
import { stripTrailingSections } from "@/lib/parse-agent-reply";
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
        // Fondu d'ouverture : le livrable détaillé s'installe en douceur quand la
        // 2e passe arrive, au lieu de surgir d'un coup.
        animation: "fndFadeIn 0.3s ease both",
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
  onLinkProject?: () => void;
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
            : "Réponse générée par votre modèle Ollama local."
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
          : "Réponse générée par votre modèle Ollama local."
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

// Indicateur de la phase "recherche web", affiché AVANT le 1er token de réponse.
// Cette étape bloque forcément la génération (le modèle attend les résultats web
// pour les intégrer au prompt) : on l'explique clairement pour que l'attente plus
// longue soit comprise plutôt que subie. On bascule ensuite sur TypingDots dès que
// le modèle commence à répondre (événement `provider` reçu).
function WebSearchingIndicator({ agentId }: { agentId: AgentId }) {
  const color = AGENTS[agentId].color;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AgentAvatar agentId={agentId} size={28} />
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: "4px 12px 12px 12px",
          padding: "10px 14px",
          boxShadow: C.shadow,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Icon
          name="search"
          size={15}
          color={color}
          style={{ animation: "fndPulse 1.2s ease-in-out infinite", flexShrink: 0 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
              Recherche web en cours
            </span>
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: color,
                    display: "inline-block",
                    animation: `fndBounce 1.1s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
          <span style={{ fontSize: 11, color: C.textMute }}>
            La réponse sera un peu plus longue, le temps de consulter le web.
          </span>
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

// Extrait un nom de site lisible depuis une URL.
// Ex: "https://www.malt.fr/profil/..." -> "malt.fr"
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Rend le contenu markdown en HTML avec les citations [1][2] remplacées par des liens.
function renderMarkdownWithCitations(
  content: string,
  sources: { title: string; url: string }[] | undefined,
  color: string,
): string {
  let processed = content;
  if (sources && sources.length > 0) {
    processed = content.replace(/\[(\d+)\]/g, (match, num) => {
      const src = sources[parseInt(num, 10) - 1];
      if (!src) return match;
      const host = hostname(src.url);
      return `<a href="${src.url}" target="_blank" rel="noopener noreferrer" title="${src.title}" style="color:${color};font-weight:600;text-decoration:underline;white-space:nowrap">${host}</a>`;
    });
  }
  return marked.parse(processed, { async: false }) as string;
}

// Bloc "Sources" affiché sous la réponse : liste les pages consultées sous forme
// de pastilles cliquables (nom du site). Toujours visible dès qu'une recherche a
// eu lieu, même si l'agent n'a pas écrit [1][2] dans son texte.
function SourcesBlock({ sources }: { sources?: { title: string; url: string }[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
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

// Indicateur discret affiché SOUS les titres de livrables pendant la 2e passe
// (Qwen matérialise les artefacts). Les titres restent visibles : on enrichit,
// on ne remplace pas par du vide.
function ArtifactsEnriching({ color }: { color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginTop: 8,
        fontSize: 11.5,
        color: C.textMute,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          animation: "fndBounce 1.1s ease-in-out infinite",
          opacity: 0.7,
        }}
      />
      Mise en forme des livrables…
    </div>
  );
}

function MessageBubble({
  msg,
  agentId,
  onConvertToTask,
  taskedItems,
  artifactsLoading,
}: {
  msg: ChatMessage;
  agentId: AgentId;
  onConvertToTask: (text: string) => void;
  taskedItems: Set<string>;
  artifactsLoading?: boolean;
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
            className="fnd-md"
            style={{ fontSize: 13.5, color: C.text, lineHeight: 1.65 }}
            dangerouslySetInnerHTML={{
              __html: renderMarkdownWithCitations(msg.content, msg.sources, agent.color),
            }}
          />
          {msg.artifacts && msg.artifacts.length > 0 ? (
            msg.artifacts.map((a, i) => (
              <ArtifactBlock
                key={i}
                artifact={a}
                color={agent.color}
                bg={agent.bg}
                onConvertToTask={onConvertToTask}
                tasked={taskedItems.has(a.title)}
              />
            ))
          ) : msg.deliverables && msg.deliverables.length > 0 ? (
            <>
              {/* Progressive disclosure : les TITRES des livrables s'affichent
                  immédiatement, puis sont remplacés en place par les artefacts
                  détaillés (2e passe). Ils ne disparaissent jamais → fini le
                  « vide puis réapparition ». */}
              <StructuredBlock
                label="Livrables"
                icon="tasks"
                items={msg.deliverables}
                color={agent.color}
                bg={agent.bg}
                onConvertToTask={onConvertToTask}
                taskedItems={taskedItems}
              />
              {artifactsLoading && <ArtifactsEnriching color={agent.color} />}
            </>
          ) : null}
          <StructuredBlock
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

export function ChatSession({
  sessionId,
  agentId,
  projectType,
  projectId,
  initialMessages,
  initialChallenger,
  onBack,
  onTitleChange,
  onLinkProject,
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
  // Recherche web : OFF par défaut. Sinon chaque message paie une étape de
  // recherche avant de répondre (lent). État local, non persisté en base.
  const [webSearch, setWebSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskedItems, setTaskedItems] = useState<Set<string>>(new Set());
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [preferredProvider, setPreferredProvider] = useState<"local" | "cloud">("cloud");

  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const savedDraftRef = useRef<string>("");
  // Scroll « collant » : on ne re-scrolle automatiquement que si l'utilisateur
  // est DÉJÀ près du bas. S'il a remonté pour relire, on ne lui arrache plus la
  // vue à chaque token / changement de hauteur.
  const atBottomRef = useRef(true);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
    setChallenger(initialChallenger);
  }, [sessionId, initialMessages, initialChallenger]);

  useEffect(() => {
    fetch("/api/ollama-status")
      .then((r) => r.json())
      .then((data: { available: boolean }) => {
        setOllamaAvailable(data.available);
        if (data.available) setPreferredProvider("local");
      })
      .catch(() => setOllamaAvailable(false));
  }, []);

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
    if (atBottomRef.current && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, loading, streamingContent, loadingArtifacts]);

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
    inputHistoryRef.current = [trimmed, ...inputHistoryRef.current.filter((m) => m !== trimmed)].slice(0, 50);
    historyIndexRef.current = -1;
    savedDraftRef.current = "";

    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      ts: new Date().toISOString(),
    };
    setMessages((p) => [...p, userMsg]);
    setLoading(true);
    setStreamingContent("");
    // L'utilisateur vient d'envoyer : on le ramène en bas pour suivre la réponse.
    atBottomRef.current = true;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: trimmed, preferredProvider, webSearch }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Erreur réseau." }));
        const errMsg: string = data.error ?? "Erreur inconnue.";
        if (errMsg.startsWith("OLLAMA_UNAVAILABLE:")) {
          setOllamaAvailable(false);
          setPreferredProvider("cloud");
          setInput(trimmed);
          if (taRef.current) taRef.current.style.height = "auto";
          setError("Ollama indisponible — bascule sur Cloud. Réessaie avec Entrée.");
        } else {
          setError(errMsg);
        }
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
  }, [input, loading, sessionId, onTitleChange, preferredProvider, webSearch]);

  // Réponse en cours de génération, rendue comme DERNIER élément de la même
  // liste que les messages finaux (même position + même key par index). Quand
  // `text-done` arrive, le vrai message prend ce même slot : React met à jour le
  // nœud DOM au lieu de le démonter/remonter → plus de « flash » ni de swap.
  // On coupe à LIVRABLES:/CHALLENGES: avec le MÊME helper que le parseur final,
  // donc rien ne « rétrécit » au passage en message final.
  const inflight: ChatMessage | null = streamingContent
    ? {
        role: "assistant",
        content: stripTrailingSections(streamingContent),
        ts: new Date().toISOString(),
        provider: streamingProvider ?? undefined,
        providerLabel: streamingProviderLabel,
      }
    : null;
  const displayMessages = inflight ? [...messages, inflight] : messages;

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

        {onLinkProject && (
          <button
            onClick={onLinkProject}
            title={projectId ? "Changer le projet rattaché" : "Rattacher cette session à un projet"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 0 : 6,
              border: `1.5px solid ${projectId ? C.navy : C.border}`,
              background: projectId ? C.navyLight : C.white,
              color: projectId ? C.navy : C.textSub,
              borderRadius: 100,
              padding: isMobile ? "6px" : "5px 11px 5px 9px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            <Icon name="folder" size={12} color={projectId ? C.navy : C.textSub} />
            {!isMobile && (projectId ? "Projet lié" : "Rattacher à un projet")}
          </button>
        )}

        <button
          onClick={toggleChallenger}
          title="Pousse l'agent à challenger vos hypothèses"
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

        <button
          onClick={() => setWebSearch((v) => !v)}
          title="L'agent cherche sur le web avant de répondre (plus lent)"
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 0 : 7,
            border: `1.5px solid ${webSearch ? "#0EA5E9" : C.border}`,
            background: webSearch ? "#E0F2FE" : C.white,
            color: webSearch ? "#0284C7" : C.textSub,
            borderRadius: 100,
            padding: isMobile ? "6px" : "5px 11px 5px 9px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          <Icon name="search" size={12} color={webSearch ? "#0284C7" : C.textSub} />
          {!isMobile && (
            <>
              Recherche web
              <span
                style={{
                  width: 26,
                  height: 14,
                  borderRadius: 100,
                  background: webSearch ? "#0EA5E9" : C.border,
                  position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: webSearch ? 14 : 2,
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

        {/* Toggle local / cloud */}
        {!isMobile && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: `1.5px solid ${C.border}`,
              borderRadius: 100,
              overflow: "hidden",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "inherit",
            }}
          >
            {/* Bouton Local */}
            <button
              onClick={() => {
                if (ollamaAvailable === false) {
                  // Re-check Ollama puis bascule si disponible
                  fetch("/api/ollama-status")
                    .then((r) => r.json())
                    .then((data: { available: boolean }) => {
                      setOllamaAvailable(data.available);
                      if (data.available) setPreferredProvider("local");
                    })
                    .catch(() => setOllamaAvailable(false));
                } else if (ollamaAvailable === true) {
                  setPreferredProvider("local");
                }
              }}
              title={
                ollamaAvailable === null
                  ? "Vérification d'Ollama…"
                  : ollamaAvailable
                  ? "Utiliser le modèle local (données privées)"
                  : "Ollama indisponible — cliquer pour re-vérifier"
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 11px",
                border: "none",
                borderRight: `1.5px solid ${C.border}`,
                background:
                  preferredProvider === "local" && ollamaAvailable
                    ? "#F0FDF4"
                    : "transparent",
                color:
                  ollamaAvailable === false
                    ? C.textSub
                    : preferredProvider === "local"
                    ? "#16A34A"
                    : C.textSub,
                cursor: ollamaAvailable === null ? "default" : "pointer",
                transition: "all 0.15s",
                opacity: ollamaAvailable === false ? 0.5 : 1,
                fontWeight: 700,
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
              Local
              {ollamaAvailable === false && (
                <span style={{ fontSize: 10, lineHeight: 1 }} title="Re-vérifier">↻</span>
              )}
              {ollamaAvailable === null && (
                <span style={{ fontSize: 10, color: C.textSub }}>…</span>
              )}
            </button>

            {/* Bouton Cloud */}
            <button
              onClick={() => setPreferredProvider("cloud")}
              title="Utiliser Mistral Cloud"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 11px",
                border: "none",
                background: preferredProvider === "cloud" ? "#EEF2FF" : "transparent",
                color: preferredProvider === "cloud" ? "#6366F1" : C.textSub,
                cursor: "pointer",
                transition: "all 0.15s",
                fontWeight: 700,
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1 }}>☁</span>
              Cloud
            </button>
          </div>
        )}

        {/* Version mobile : icône seule */}
        {isMobile && (
          <button
            onClick={() => {
              if (preferredProvider === "cloud" && ollamaAvailable) {
                setPreferredProvider("local");
              } else if (preferredProvider === "local") {
                setPreferredProvider("cloud");
              } else {
                fetch("/api/ollama-status")
                  .then((r) => r.json())
                  .then((d: { available: boolean }) => {
                    setOllamaAvailable(d.available);
                    if (d.available) setPreferredProvider("local");
                  })
                  .catch(() => setOllamaAvailable(false));
              }
            }}
            title={preferredProvider === "local" ? "Local actif" : "Cloud actif"}
            style={{
              background: preferredProvider === "local" ? "#F0FDF4" : "#EEF2FF",
              border: `1.5px solid ${preferredProvider === "local" ? "#16A34A" : "#6366F1"}`,
              color: preferredProvider === "local" ? "#16A34A" : "#6366F1",
              borderRadius: 100,
              padding: "6px 8px",
              cursor: "pointer",
              fontSize: 14,
              fontFamily: "inherit",
              opacity: ollamaAvailable === false && preferredProvider === "local" ? 0.5 : 1,
            }}
          >
            {ollamaAvailable === null ? "…" : preferredProvider === "local" ? "●" : "☁"}
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        onScroll={handleMessagesScroll}
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
            Dites à <strong style={{ color: agent.color }}>{agent.firstName}</strong> sur quoi vous voulez travailler aujourd'hui.
            <br />
            Plus vous donnez de contexte, plus la session sera utile.
          </div>
        )}
        {displayMessages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            agentId={agentId}
            onConvertToTask={convertToTask}
            taskedItems={taskedItems}
            artifactsLoading={
              loadingArtifacts && i === displayMessages.length - 1 && m.role === "assistant"
            }
          />
        ))}
        {/* Annonce du provider cloud AVANT le 1er token. Une fois le texte qui
            coule, le badge compact dans l'en-tête du message suffit (pas de doublon). */}
        {streamingProvider === "cloud" && !streamingContent && (
          <div style={{ paddingLeft: 38 }}>
            <ProviderBadge
              provider="cloud"
              label={streamingProviderLabel}
              variant="announce"
            />
          </div>
        )}
        {loading &&
          !streamingContent &&
          // On n'affiche les points QUE tant qu'aucune réponse assistant n'est
          // encore à l'écran : avant le 1er token. Après `text-done`, le dernier
          // message est l'assistant (et la mise en forme des livrables a son
          // propre indicateur dans la bulle) → pas de points qui reviennent.
          displayMessages[displayMessages.length - 1]?.role !== "assistant" &&
          // Si la recherche web est active et que le modèle n'a pas commencé,
          // on est dans l'étape de recherche : on l'annonce. Sinon, points classiques.
          (webSearch && !streamingProvider ? (
            <WebSearchingIndicator agentId={agentId} />
          ) : (
            <TypingDots agentId={agentId} />
          ))}
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

      {/* Rappel proactif : tant que la recherche web est active, on prévient que
          les réponses seront plus lentes — l'utilisateur le sait AVANT d'envoyer. */}
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
          Recherche web activée : l'agent consulte le web avant de répondre, les
          réponses sont donc plus lentes.
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
              } else if (e.key === "ArrowUp" && !e.shiftKey) {
                const history = inputHistoryRef.current;
                if (!history.length) return;
                if (historyIndexRef.current === -1) savedDraftRef.current = input;
                const next = Math.min(historyIndexRef.current + 1, history.length - 1);
                historyIndexRef.current = next;
                const val = history[next];
                setInput(val);
                e.preventDefault();
                requestAnimationFrame(() => {
                  if (taRef.current) {
                    taRef.current.style.height = "auto";
                    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + "px";
                    taRef.current.setSelectionRange(val.length, val.length);
                  }
                });
              } else if (e.key === "ArrowDown" && !e.shiftKey) {
                const history = inputHistoryRef.current;
                if (historyIndexRef.current === -1) return;
                const next = historyIndexRef.current - 1;
                historyIndexRef.current = next;
                const val = next === -1 ? savedDraftRef.current : history[next];
                setInput(val);
                e.preventDefault();
                requestAnimationFrame(() => {
                  if (taRef.current) {
                    taRef.current.style.height = "auto";
                    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + "px";
                    taRef.current.setSelectionRange(val.length, val.length);
                  }
                });
              }
            }}
            placeholder={`Posez votre question à ${agent.firstName}…`}
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
