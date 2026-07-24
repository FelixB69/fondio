"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import {
  AGENTS,
  AgentId,
  ChatMessage,
  PROJECT_TYPES,
  ProjectType,
  SessionRow,
} from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { prettyModelName, type ModelProvider, type ModelStatus } from "@/lib/models";
import { stripTrailingSections } from "@/lib/parse-agent-reply";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import type { ProjectLite } from "./AppDataProvider";
import { ArtifactBlock } from "./Artifact";
import { Icon, IconName } from "./Icon";
import { ModelSelector } from "./ModelSelector";
import { ProjectLinkButton } from "./ProjectLinkButton";

interface ChatSessionProps {
  sessionId: string;
  agentId: AgentId;
  projectType: ProjectType;
  projectId?: string | null;
  project?: ProjectLite | null;
  // Mode Accompagné : barre d'experts toujours visible, relais via ORIENTER,
  // bandeau de matérialisation du projet. Off = session mono-agent classique.
  guided?: boolean;
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
  provider: "local" | "cloud" | "byok";
  label?: string;
  variant?: "compact" | "announce";
}) {
  const isCloud = provider === "cloud";
  const PROVIDER_STYLES = {
    local: { color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0", icon: "●", defaultText: "Modèle local" },
    cloud: { color: "#D97706", bg: "#FFF7ED", border: "#FED7AA", icon: "☁", defaultText: "Mistral Cloud" },
    byok: { color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", icon: "🔑", defaultText: "Votre clé" },
  } as const;
  const { color, bg, border, icon, defaultText } = PROVIDER_STYLES[provider];
  const text = label ?? defaultText;

  if (variant === "announce") {
    const title =
      provider === "byok"
        ? "Réponse générée avec votre clé API personnelle (BYOK)."
        : isCloud
          ? "Ollama local indisponible, bascule automatique sur l'API Mistral (EU)."
          : "Réponse générée par votre modèle Ollama local.";
    return (
      <div
        title={title}
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

  const compactTitle =
    provider === "byok"
      ? "Réponse générée avec votre clé API personnelle (BYOK)."
      : isCloud
        ? "Réponse générée via l'API Mistral (Ollama local était indisponible)."
        : "Réponse générée par votre modèle Ollama local.";

  return (
    <span
      title={compactTitle}
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

// Calque discret listant les termes techniques expliqués ce tour-ci (section
// LEXIQUE). Volontairement sobre : la prose reste l'accompagnement, ceci est un
// aide-mémoire consultable, pas un cours inséré dans le texte.
function LexiconBlock({ entries }: { entries: { term: string; definition: string }[] }) {
  if (!entries.length) return null;
  return (
    <div
      style={{
        marginTop: 10,
        background: "#F8FAFC",
        border: `1px solid ${C.border}`,
        borderRadius: 9,
        padding: "9px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          color: C.textSub,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        <Icon name="book" size={12} color={C.textSub} />
        Termes expliqués
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45 }}>
            <span style={{ fontWeight: 700 }}>{e.term}</span>
            <span style={{ color: C.textSub }}> — {e.definition}</span>
          </div>
        ))}
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

// Actions sous une réponse d'agent : copier le texte, et régénérer (dernier tour).
function MessageActions({
  content,
  onRegenerate,
}: {
  content: string;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refusé : on ignore silencieusement */
    }
  };
  const btn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "none",
    color: C.textMute,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: 5,
  };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6, marginLeft: 2 }}>
      <button onClick={copy} title="Copier la réponse" style={btn}>
        <Icon name={copied ? "check" : "copy"} size={11} color={copied ? "#0E9F88" : C.textMute} />
        {copied ? "Copié" : "Copier"}
      </button>
      {onRegenerate && (
        <button onClick={onRegenerate} title="Régénérer la réponse" style={btn}>
          <Icon name="refresh" size={11} color={C.textMute} />
          Régénérer
        </button>
      )}
    </div>
  );
}

// Mémoïsé : pendant le streaming, seul le dernier message (en cours) change.
// Sans memo, chaque token re-rendait TOUT l'historique des bulles.
const MessageBubble = memo(function MessageBubble({
  msg,
  agentId,
  onConvertToTask,
  taskedItems,
  artifactsLoading,
  onRegenerate,
  showActions,
}: {
  msg: ChatMessage;
  agentId: AgentId;
  onConvertToTask: (text: string) => void;
  taskedItems: Set<string>;
  artifactsLoading?: boolean;
  onRegenerate?: () => void;
  showActions?: boolean;
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
            label="Questions difficiles"
            icon="zap"
            items={msg.challenges ?? []}
            color="#D97706"
            bg="#FFFBEB"
          />
          <StructuredBlock
            label="Tâches ajoutées au projet"
            icon="tasks"
            items={msg.tasks ?? []}
            color="#264573"
            bg="#EEF2FA"
          />
          <LexiconBlock entries={msg.lexicon ?? []} />
          <SourcesBlock sources={msg.sources} />
        </div>
        {showActions && <MessageActions content={msg.content} onRegenerate={onRegenerate} />}
      </div>
    </div>
  );
});

// Séparateur de relais : marque la 1re prise de parole d'un nouvel expert dans
// le fil continu du mode Accompagné.
function HandoffDivider({ agentId }: { agentId: AgentId }) {
  const a = AGENTS[agentId];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 2px" }}>
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
          fontWeight: 700,
          color: a.color,
          background: a.bg,
          border: `1px solid ${a.color}30`,
          borderRadius: 100,
          padding: "3px 11px",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name={a.icon as IconName} size={11} color={a.color} />
        {a.firstName} rejoint la conversation
      </span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

// Suggestion d'orientation émise par l'agent (section ORIENTER). Bonus
// opportuniste : si le modèle ne la produit jamais, la barre d'experts reste le
// moyen principal de changer d'interlocuteur.
function OrientSuggestion({
  agentId,
  reason,
  onAccept,
  onDismiss,
}: {
  agentId: AgentId;
  reason: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const a = AGENTS[agentId];
  return (
    <div
      style={{
        marginLeft: 38,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: a.bg,
        border: `1.5px solid ${a.color}40`,
        borderRadius: 11,
        padding: "10px 13px",
      }}
    >
      <Icon name="sparkles" size={14} color={a.color} />
      <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: C.text, lineHeight: 1.45 }}>
        Ce point relève de <strong style={{ color: a.color }}>{a.firstName}</strong> ({a.name})
        {reason ? ` — ${reason}` : ""}.
      </span>
      <button
        onClick={onAccept}
        style={{
          background: a.color,
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "7px 13px",
          fontSize: 12.5,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Passer à {a.firstName}
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: C.textMute,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          padding: "7px 4px",
        }}
      >
        Non merci
      </button>
    </div>
  );
}

// Barre d'experts TOUJOURS visible en mode Accompagné. C'est le vrai levier de
// changement d'interlocuteur : la feature ne dépend donc pas de la capacité du
// modèle local à émettre ORIENTER au bon moment (dégradation propre).
function ExpertBar({
  currentAgentId,
  onPick,
  disabled,
  isMobile,
}: {
  currentAgentId: AgentId;
  onPick: (id: AgentId) => void;
  disabled: boolean;
  isMobile: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: isMobile ? "8px 12px" : "9px 20px",
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {!isMobile && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.textMute, flexShrink: 0, marginRight: 2 }}>
          Vos experts
        </span>
      )}
      {(Object.keys(AGENTS) as AgentId[]).map((id) => {
        const a = AGENTS[id];
        const active = id === currentAgentId;
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            disabled={disabled || active}
            title={`${a.name} — ${a.desc}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              background: active ? a.bg : C.white,
              color: active ? a.color : C.textSub,
              border: `1.5px solid ${active ? a.color : C.border}`,
              borderRadius: 100,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "inherit",
              cursor: disabled || active ? "default" : "pointer",
              opacity: disabled && !active ? 0.5 : 1,
              transition: "all 0.15s",
            }}
          >
            <Icon name={a.icon as IconName} size={12} color={active ? a.color : C.textMute} />
            {a.firstName}
            <span style={{ fontWeight: 500, color: active ? a.color : C.textMute, opacity: 0.75 }}>
              · {a.role1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChatSession({
  sessionId,
  agentId,
  projectType,
  projectId,
  project = null,
  guided = false,
  initialMessages,
  initialChallenger,
  onBack,
  onTitleChange,
  onLinkProject,
}: ChatSessionProps) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  // Mode Accompagné : l'agent « lead » peut changer en cours de route (relais).
  // On garde donc l'agent courant en état local, initialisé sur celui de la session.
  const [currentAgentId, setCurrentAgentId] = useState<AgentId>(agentId);
  const agent = AGENTS[currentAgentId];
  const typeMeta = PROJECT_TYPES[projectType] ?? PROJECT_TYPES.other;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  // Suggestions d'orientation refusées (index de message) — ne pas re-proposer.
  const [dismissedOrient, setDismissedOrient] = useState<Set<number>>(new Set());
  // Bandeau « créer le projet » masqué manuellement pour cette session.
  const [projectBannerDismissed, setProjectBannerDismissed] = useState(false);
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
  const [preferredProvider, setPreferredProvider] = useState<ModelProvider>("cloud");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const savedDraftRef = useRef<string>("");
  // Permet de couper une génération en cours (bouton Stop) en abandonnant le fetch.
  const abortRef = useRef<AbortController | null>(null);
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
    setCurrentAgentId(agentId);
    setDismissedOrient(new Set());
    setProjectBannerDismissed(false);
  }, [sessionId, initialMessages, initialChallenger, agentId]);

  // Interroge Ollama + récupère la config réelle des modèles. Local d'abord :
  // si Ollama répond, on bascule sur local (objectif confidentialité). Réutilisé
  // par le ModelSelector pour son bouton « re-vérifier ».
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
        source_agent_id: currentAgentId,
      });
    },
    [currentAgentId, sessionId, supabase, taskedItems],
  );

  // Relais d'expert : bascule l'agent lead (barre d'experts ou acceptation d'une
  // suggestion ORIENTER). On persiste agent_id ; le prochain tour répondra avec
  // le nouvel agent, et son message portera son agentId (séparateur de relais).
  const switchAgent = useCallback(
    async (id: AgentId) => {
      if (id === currentAgentId || loading) return;
      setCurrentAgentId(id);
      await supabase.from("sessions").update({ agent_id: id }).eq("id", sessionId);
    },
    [currentAgentId, loading, sessionId, supabase],
  );

  const toggleChallenger = useCallback(async () => {
    const next = !challenger;
    setChallenger(next);
    await supabase.from("sessions").update({ challenger_mode: next }).eq("id", sessionId);
  }, [challenger, sessionId, supabase, projectId]);

  // Lit le flux NDJSON de /api/chat et met à jour l'UI. Partagé par l'envoi et la
  // régénération. `onRollback` est appelé sur une erreur serveur (le seul qui
  // sait s'il faut retirer le message utilisateur optimiste ou non).
  const consumeStream = useCallback(
    async (res: Response, onRollback: () => void) => {
      const reader = res.body!.getReader();
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
              onRollback();
              rolledBack = true;
            }
            setStreamingContent("");
            setStreamingProvider(null);
            setStreamingProviderLabel(undefined);
            setLoadingArtifacts(false);
          }
        }
      }
    },
    [onTitleChange],
  );

  // Cœur d'envoi, extrait pour être réutilisé par le message d'amorce du mode
  // Accompagné (la description saisie à la création) — pas seulement par la zone
  // de saisie.
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: trimmed, preferredProvider, webSearch }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Erreur réseau." }));
        const errMsg: string = data.error ?? "Erreur inconnue.";
        if (errMsg.startsWith("OLLAMA_UNAVAILABLE:")) {
          setModelStatus((prev) => (prev ? { ...prev, available: false } : prev));
          setPreferredProvider("cloud");
          setInput(trimmed);
          if (taRef.current) taRef.current.style.height = "auto";
          setError("Ollama indisponible, bascule sur Cloud. Réessaie avec Entrée.");
        } else {
          setError(errMsg);
        }
        setMessages((p) => p.slice(0, -1));
        return;
      }

      await consumeStream(res, () => setMessages((p) => p.slice(0, -1)));
    } catch (e: unknown) {
      // Stop volontaire : on retire le tour et on rend son texte à l'utilisateur.
      if (e instanceof DOMException && e.name === "AbortError") {
        setMessages((p) => p.slice(0, -1));
        setInput(trimmed);
      } else {
        setError(e instanceof Error ? e.message : "Erreur réseau.");
        setMessages((p) => p.slice(0, -1));
      }
      setStreamingContent("");
      setStreamingProvider(null);
      setStreamingProviderLabel(undefined);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, sessionId, preferredProvider, webSearch, consumeStream]);

  const handleSend = useCallback(() => {
    void sendMessage(input);
  }, [input, sendMessage]);

  // Mode Accompagné : la description saisie à la création est déposée en
  // sessionStorage par l'écran d'entrée (évite de la faire transiter par l'URL).
  // On l'envoie automatiquement au 1er rendu d'une session encore vide, pour que
  // Clara démarre sur le contexte du projet sans que l'utilisateur re-saisisse.
  const kickedRef = useRef(false);
  useEffect(() => {
    if (!guided || kickedRef.current || initialMessages.length > 0) return;
    if (typeof window === "undefined") return;
    const key = `fnd_kickoff_${sessionId}`;
    const text = window.sessionStorage.getItem(key);
    if (!text) return;
    kickedRef.current = true;
    window.sessionStorage.removeItem(key);
    void sendMessage(text);
  }, [guided, sessionId, initialMessages, sendMessage]);

  // Régénère la dernière réponse de l'agent : on retire la (les) bulle(s)
  // assistant en bout de fil, puis on rejoue le dernier message utilisateur.
  const handleRegenerate = useCallback(async () => {
    if (loading) return;
    const hasAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";
    if (!hasAssistant) return;
    setError(null);
    setMessages((p) => {
      const m = [...p];
      while (m.length && m[m.length - 1].role === "assistant") m.pop();
      return m;
    });
    setLoading(true);
    setStreamingContent("");
    atBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userMessage: "", preferredProvider, webSearch, regenerate: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Erreur réseau." }));
        setError(data.error ?? "Erreur inconnue.");
        return;
      }
      // Rien à annuler côté UI sur erreur : le message utilisateur doit rester.
      await consumeStream(res, () => {});
    } catch (e: unknown) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Erreur réseau.");
      }
      setStreamingContent("");
      setStreamingProvider(null);
      setStreamingProviderLabel(undefined);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, messages, sessionId, preferredProvider, webSearch, consumeStream]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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

  // Matérialisation du projet : en mode Accompagné, on ne crée AUCUN projet au
  // démarrage (une description vague donnerait un projet fantôme mal nommé). On
  // le propose seulement quand le cadrage a produit de la matière — ici, 2
  // réponses d'agent — et jamais si la session est déjà rattachée.
  const assistantTurns = messages.filter((m) => m.role === "assistant").length;
  const showProjectBanner =
    guided && !projectId && !projectBannerDismissed && !!onLinkProject && assistantTurns >= 2;

  // Modèles réellement en service (selon le choix local/cloud et la dispo Ollama),
  // pour un pied de page honnête au lieu d'un « Llama3 » codé en dur.
  const useLocal = preferredProvider === "local" && (modelStatus?.available ?? false);
  const activeChatModel = modelStatus
    ? prettyModelName(useLocal ? modelStatus.local.chat : modelStatus.cloud.chat)
    : null;
  const activeArtifactModel = modelStatus
    ? prettyModelName(useLocal ? modelStatus.local.artifact : modelStatus.cloud.artifact)
    : null;

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

        <AgentAvatar agentId={currentAgentId} size={isMobile ? 28 : 34} />
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
          <ProjectLinkButton project={project} isMobile={isMobile} onClick={onLinkProject} />
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

        {/* Sélecteur de modèle : montre l'IA active et permet d'en changer. */}
        <ModelSelector
          status={modelStatus}
          provider={preferredProvider}
          onChange={setPreferredProvider}
          onRefresh={() => refreshStatus()}
          refreshing={statusRefreshing}
          compact={isMobile}
        />
      </div>

      {/* Mode Accompagné : barre d'experts toujours accessible. */}
      {guided && (
        <ExpertBar
          currentAgentId={currentAgentId}
          onPick={(id) => void switchAgent(id)}
          disabled={loading}
          isMobile={isMobile}
        />
      )}

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
        {displayMessages.map((m, i) => {
          // Actions (copier / régénérer) seulement sur la DERNIÈRE réponse finale,
          // quand rien n'est en cours (pas pendant le streaming ni l'enrichissement).
          const isLastFinal =
            !inflight && !loading && i === displayMessages.length - 1 && m.role === "assistant";
          // Chaque réponse est rendue par SON auteur (mode Accompagné : l'agent
          // change au fil des relais). Repli sur l'agent courant pour les anciens
          // messages non estampillés.
          const speaker =
            m.role === "assistant" && m.agentId && m.agentId !== "__synthesis__"
              ? (m.agentId as AgentId)
              : currentAgentId;
          // Séparateur de relais : première prise de parole d'un nouvel expert.
          const prevSpeaker = displayMessages
            .slice(0, i)
            .reverse()
            .find((p) => p.role === "assistant" && p.agentId && p.agentId !== "__synthesis__")
            ?.agentId as AgentId | undefined;
          const showHandoff =
            guided && m.role === "assistant" && !!m.agentId && !!prevSpeaker && prevSpeaker !== speaker;
          // Suggestion d'orientation : uniquement sur la dernière réponse, si elle
          // vise un autre agent que l'actuel et n'a pas été refusée.
          const orient = m.orient;
          const showOrient =
            guided &&
            isLastFinal &&
            !!orient &&
            orient.agentId !== currentAgentId &&
            !dismissedOrient.has(i);
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {showHandoff && <HandoffDivider agentId={speaker} />}
              <MessageBubble
                msg={m}
                agentId={speaker}
                onConvertToTask={convertToTask}
                taskedItems={taskedItems}
                artifactsLoading={
                  loadingArtifacts && i === displayMessages.length - 1 && m.role === "assistant"
                }
                showActions={isLastFinal}
                onRegenerate={isLastFinal ? handleRegenerate : undefined}
              />
              {showOrient && orient && (
                <OrientSuggestion
                  agentId={orient.agentId}
                  reason={orient.reason}
                  onAccept={() => void switchAgent(orient.agentId)}
                  onDismiss={() => setDismissedOrient((p) => new Set(p).add(i))}
                />
              )}
            </div>
          );
        })}
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
            <WebSearchingIndicator agentId={currentAgentId} />
          ) : (
            <TypingDots agentId={currentAgentId} />
          ))}
        <div />
      </div>

      {showProjectBanner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: isMobile ? "10px 12px" : "10px 20px",
            background: C.navyLight,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <Icon name="target" size={14} color={C.navy} />
          <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: C.text, lineHeight: 1.45 }}>
            Votre projet se dessine. Le créer pour suivre votre progression par paliers ?
          </span>
          <button
            onClick={onLinkProject}
            style={{
              background: C.navy,
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "7px 13px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Créer le projet
          </button>
          <button
            onClick={() => setProjectBannerDismissed(true)}
            style={{
              background: "none",
              border: "none",
              color: C.textMute,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "7px 4px",
            }}
          >
            Plus tard
          </button>
        </div>
      )}

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
          {loading ? (
            <button
              onClick={handleStop}
              title="Arrêter la génération"
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
                transition: "background 0.15s",
              }}
            >
              {/* Carré « stop » */}
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
                background: input.trim() ? agent.color : C.border,
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
          Entrée pour envoyer · Shift+Entrée pour saut de ligne
          {activeChatModel && (
            <>
              {" · "}
              {activeChatModel} + {activeArtifactModel} (livrables)
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export type { ChatSessionProps, SessionRow };
