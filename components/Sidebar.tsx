"use client";

import { memo, useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";
import { AGENTS, AgentId, ProjectType, PROJECT_TYPES } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { formatRelative } from "@/lib/format";
import { useIsMobile } from "@/lib/use-responsive";
import type { ProjectLite } from "./AppDataProvider";
import { Icon, IconName } from "./Icon";

export type SidebarView = "chat" | "library" | "tasks" | "agenda" | "projects";

export interface SessionListItem {
  id: string;
  agent_id: AgentId;
  project_type: ProjectType;
  project_id?: string | null;
  title: string | null;
  updated_at: string;
  panel_agent_ids?: string[] | null;
}

interface SidebarProps {
  sessions: SessionListItem[];
  archivedSessions: SessionListItem[];
  projectsById: Record<string, ProjectLite>;
  activeSessionId: string | null;
  currentView: SidebarView;
  taskOpenCount?: number;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenAccount: () => void;
  onSignOut: () => void;
  onArchiveSession: (id: string) => void;
  onRestoreSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onLinkSession: (id: string) => void;
  userEmail?: string;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

function NavItem({
  icon,
  label,
  active,
  href,
  onClick,
  badge,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  href?: string;
  onClick?: () => void;
  badge?: number;
}) {
  const base: CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "7px 10px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    background: active ? C.navyLight : "transparent",
    color: active ? C.navy : C.textSub,
    fontWeight: active ? 700 : 500,
    fontSize: 13,
    transition: "background 0.12s",
    fontFamily: "inherit",
    textDecoration: "none",
  };
  const content = (
    <>
      <Icon name={icon} size={14} color={active ? C.navy : C.textSub} />
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            background: active ? C.navy : C.border,
            color: active ? "white" : C.textSub,
            fontSize: 10,
            fontWeight: 800,
            padding: "1px 7px",
            borderRadius: 100,
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </>
  );
  const hoverHandlers = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      if (!active) e.currentTarget.style.background = "#F1F5F9";
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      if (!active) e.currentTarget.style.background = "transparent";
    },
  };
  if (href) {
    return (
      <Link href={href} style={base} {...hoverHandlers}>
        {content}
      </Link>
    );
  }
  return (
    <button onClick={onClick} style={base} {...hoverHandlers}>
      {content}
    </button>
  );
}

// Ligne de session de la liste active. L'état de survol est LOCAL : survoler une
// ligne ne re-render plus toute la sidebar (avant : `hoveredId` au niveau parent
// re-rendait l'ensemble des sessions). Mémoïsé pour éviter les rendus inutiles
// quand la liste change mais que cette ligne reste identique.
const SessionRow = memo(function SessionRow({
  s,
  active,
  project,
  onSelect,
  onLink,
  onArchive,
}: {
  s: SessionListItem;
  active: boolean;
  project: ProjectLite | undefined;
  onSelect: (id: string) => void;
  onLink: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isPanel = Array.isArray(s.panel_agent_ids) && s.panel_agent_ids.length > 1;
  const agent = AGENTS[s.agent_id];
  const meta = PROJECT_TYPES[s.project_type];
  return (
    <div
      style={{ position: "relative", marginBottom: 2 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => onSelect(s.id)}
        style={{
          width: "100%",
          display: "flex",
          gap: 8,
          padding: hovered ? "8px 58px 8px 10px" : "8px 10px",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
          background: active ? C.navyLight : hovered ? "#F1F5F9" : "transparent",
          textAlign: "left",
          fontFamily: "inherit",
          transition: "background 0.12s, padding 0.1s",
          alignItems: "flex-start",
        }}
      >
        {isPanel ? (
          <div style={{ display: "flex", flexShrink: 0 }}>
            {(s.panel_agent_ids ?? []).slice(0, 3).map((id, i) => (
              <div
                key={id}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: AGENTS[id as AgentId]?.bg ?? C.bg,
                  border: "1.5px solid white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  marginLeft: i > 0 ? -6 : 0,
                  position: "relative",
                  zIndex: 3 - i,
                }}
              >
                <Icon name={(AGENTS[id as AgentId]?.icon ?? "sparkles") as IconName} size={10} color={AGENTS[id as AgentId]?.color ?? C.text} />
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: agent?.bg ?? C.bg,
              border: `1.5px solid ${agent?.color ?? C.border}25`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 13,
            }}
          >
            <Icon name={(agent?.icon ?? "sparkles") as IconName} size={13} color={agent?.color ?? C.text} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: active ? 700 : 600,
              color: C.text,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {s.title ?? "Nouvelle session"}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: meta?.color ?? C.textMute,
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            {isPanel ? `Panel · ${s.panel_agent_ids?.length} agents` : agent?.name} · {formatRelative(s.updated_at)}
          </div>
          {project && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                maxWidth: "100%",
                marginTop: 4,
                padding: "1px 7px 1px 3px",
                borderRadius: 100,
                background: C.navyLight,
                border: `1px solid ${C.navy}22`,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 4,
                  background: project.color ?? C.navy,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name={(project.icon ?? "target") as IconName} size={8} color="white" />
              </span>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: C.navy,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {project.name}
              </span>
            </div>
          )}
        </div>
      </button>

      {hovered && (
        <div
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            gap: 1,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLink(s.id);
            }}
            title={s.project_id ? "Changer de projet" : "Rattacher à un projet"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: 5,
              color: s.project_id ? C.navy : C.textMute,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = C.navy;
              e.currentTarget.style.background = C.navyLight;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = s.project_id ? C.navy : C.textMute;
              e.currentTarget.style.background = "none";
            }}
          >
            <Icon name="target" size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive(s.id);
            }}
            title="Archiver"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: 5,
              color: C.textMute,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = C.navy;
              e.currentTarget.style.background = C.navyLight;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = C.textMute;
              e.currentTarget.style.background = "none";
            }}
          >
            <Icon name="archive" size={13} />
          </button>
        </div>
      )}
    </div>
  );
});

export function Sidebar({
  sessions,
  archivedSessions,
  projectsById,
  activeSessionId,
  currentView,
  taskOpenCount,
  onSelectSession,
  onNewSession,
  onOpenAccount,
  onSignOut,
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  onLinkSession,
  userEmail,
  isMobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const isMobile = useIsMobile();
  const [showArchives, setShowArchives] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const newBtnBase: CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "9px 12px",
    background: C.navy,
    color: "white",
    border: "none",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
  };

  return (
    <div
      style={{
        width: 244,
        height: "100dvh",
        background: C.white,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        ...(isMobile ? {
          position: "fixed" as const,
          top: 0,
          left: 0,
          zIndex: 99,
          transform: isMobileOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease",
          boxShadow: isMobileOpen ? "4px 0 24px rgba(0,0,0,0.18)" : "none",
        } : {}),
      }}
    >
      {/* Logo */}
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <img src="/fondio.gif" alt="Fondio" style={{ height: 60, width: "auto", display: "block", flex: 1 }} />
        {isMobile && (
          <button
            onClick={onMobileClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              borderRadius: 6,
              color: C.textSub,
              flexShrink: 0,
            }}
          >
            <Icon name="close" size={18} color={C.textSub} />
          </button>
        )}
      </div>

      {/* New session */}
      <div style={{ padding: "12px 12px 6px" }}>
        <button onClick={onNewSession} style={newBtnBase}>
          <Icon name="plus" size={13} color="white" />
          Nouvelle session
        </button>
      </div>

      {/* Nav */}
      <div style={{ padding: "6px 8px 4px" }}>
        <NavItem icon="target" label="Projets" active={currentView === "projects"} href="/projects" />
        <NavItem icon="book" label="Bibliothèque" active={currentView === "library"} href="/library" />
        <NavItem
          icon="tasks"
          label="Tâches"
          active={currentView === "tasks"}
          href="/tasks"
          badge={taskOpenCount}
        />
        <NavItem icon="clock" label="Agenda" active={currentView === "agenda"} href="/agenda" />
      </div>

      <div style={{ margin: "4px 16px 0", borderTop: `1px solid ${C.border}` }} />

      {/* Sessions list */}
      <div style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
        <div
          style={{
            padding: "6px 6px 8px",
            fontSize: 10.5,
            fontWeight: 700,
            color: C.textMute,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          Historique
        </div>
        {sessions.length === 0 && (
          <div style={{ padding: "8px 8px", fontSize: 12, color: C.textMute, lineHeight: 1.5 }}>
            Pas encore de session. Démarrez-en une depuis le bouton ci-dessus.
          </div>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            s={s}
            active={currentView === "chat" && s.id === activeSessionId}
            project={s.project_id ? projectsById[s.project_id] : undefined}
            onSelect={onSelectSession}
            onLink={onLinkSession}
            onArchive={onArchiveSession}
          />
        ))}

        {/* Archives section */}
        {archivedSessions.length > 0 && (
          <>
            <div style={{ margin: "8px 4px 4px", borderTop: `1px solid ${C.border}` }} />
            <button
              onClick={() => setShowArchives((p) => !p)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 6px 6px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 700,
                color: C.textMute,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                fontFamily: "inherit",
              }}
            >
              <Icon
                name={showArchives ? "chevDown" : "chevRight"}
                size={11}
                color={C.textMute}
              />
              Archives ({archivedSessions.length})
            </button>

            {showArchives &&
              archivedSessions.map((s) => {
                const agent = AGENTS[s.agent_id];
                const isConfirming = confirmDeleteId === s.id;
                return (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "6px 8px",
                      borderRadius: 7,
                      marginBottom: 2,
                      alignItems: "center",
                      background: "#F8FAFC",
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: agent?.bg ?? C.bg,
                        border: `1.5px solid ${agent?.color ?? C.border}25`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        flexShrink: 0,
                        opacity: 0.7,
                      }}
                    >
                      <Icon name={(agent?.icon ?? "sparkles") as IconName} size={11} color={agent?.color ?? C.text} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 500,
                          color: C.textSub,
                          lineHeight: 1.3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.title ?? "Nouvelle session"}
                      </div>
                    </div>

                    {/* Restore */}
                    <button
                      onClick={() => {
                        setConfirmDeleteId(null);
                        onRestoreSession(s.id);
                      }}
                      title="Restaurer"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 3,
                        borderRadius: 4,
                        color: C.textMute,
                        display: "flex",
                        alignItems: "center",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = C.navy;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = C.textMute;
                      }}
                    >
                      <Icon name="refresh" size={12} />
                    </button>

                    {/* Delete permanently */}
                    <button
                      onClick={() => {
                        if (isConfirming) {
                          setConfirmDeleteId(null);
                          onDeleteSession(s.id);
                        } else {
                          setConfirmDeleteId(s.id);
                        }
                      }}
                      title={isConfirming ? "Cliquer pour confirmer la suppression" : "Supprimer définitivement"}
                      style={{
                        background: isConfirming ? "#FEF0F4" : "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "3px 5px",
                        borderRadius: 4,
                        color: isConfirming ? C.pink : C.textMute,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        flexShrink: 0,
                        fontSize: 10,
                        fontFamily: "inherit",
                        fontWeight: isConfirming ? 700 : 400,
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isConfirming) e.currentTarget.style.color = C.pink;
                      }}
                      onMouseLeave={(e) => {
                        if (!isConfirming) e.currentTarget.style.color = C.textMute;
                      }}
                    >
                      <Icon name="trash" size={12} color={isConfirming ? C.pink : "currentColor"} />
                      {isConfirming && <span>Confirmer</span>}
                    </button>
                  </div>
                );
              })}
          </>
        )}
      </div>

      {/* User footer */}
      <div style={{ padding: "10px 10px 14px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px" }}>
          <button
            onClick={onOpenAccount}
            title="Gérer mon compte"
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.pink} 0%, ${C.mint} 100%)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <span style={{ color: "white", fontWeight: 800, fontSize: 11 }}>
              {(userEmail?.[0] ?? "U").toUpperCase()}
            </span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <button
              onClick={onOpenAccount}
              title={userEmail}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontSize: 12.5,
                color: C.text,
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
                fontFamily: "inherit",
                display: "block",
                width: "100%",
                textAlign: "left",
              }}
            >
              {userEmail ?? "Utilisateur"}
            </button>
            <button
              onClick={onSignOut}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontSize: 11,
                color: C.textMute,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Se déconnecter
            </button>
          </div>
          <button
            onClick={onOpenAccount}
            title="Gérer mon compte"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 5,
              borderRadius: 6,
              color: C.textMute,
              display: "flex",
              flexShrink: 0,
            }}
          >
            <Icon name="settings" size={14} color={C.textMute} />
          </button>
        </div>
      </div>
    </div>
  );
}
