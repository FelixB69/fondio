"use client";

import { useState, type CSSProperties } from "react";
import { AGENTS, AgentId, ProjectType, PROJECT_TYPES } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { Icon, IconName } from "./Icon";

export type SidebarView = "chat" | "library" | "tasks";

export interface SessionListItem {
  id: string;
  agent_id: AgentId;
  project_type: ProjectType;
  title: string | null;
  updated_at: string;
}

interface SidebarProps {
  sessions: SessionListItem[];
  archivedSessions: SessionListItem[];
  activeSessionId: string | null;
  currentView: SidebarView;
  taskOpenCount?: number;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onNavigate: (view: Exclude<SidebarView, "chat">) => void;
  onSignOut: () => void;
  onArchiveSession: (id: string) => void;
  onRestoreSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  userEmail?: string;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "À l'instant";
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `Il y a ${d}j`;
  const w = Math.round(d / 7);
  return `Il y a ${w} sem.`;
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
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
  };
  return (
    <button
      onClick={onClick}
      style={base}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "#F1F5F9";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
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
    </button>
  );
}

export function Sidebar({
  sessions,
  archivedSessions,
  activeSessionId,
  currentView,
  taskOpenCount,
  onSelectSession,
  onNewSession,
  onNavigate,
  onSignOut,
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  userEmail,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
        height: "100vh",
        background: C.white,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <svg
            width="30"
            height="30"
            viewBox="0 0 30 30"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ flexShrink: 0 }}
          >
            <circle cx="15" cy="15" r="13" stroke="#CC00CC" strokeWidth="1" />
            <circle cx="15" cy="15" r="7" stroke="#00CCCC" strokeWidth="1" />
          </svg>
          <div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                color: C.text,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              fondio
            </div>
            <div style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.04em" }}>CONSEIL IA</div>
          </div>
        </div>
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
        <NavItem
          icon="book"
          label="Bibliothèque"
          active={currentView === "library"}
          onClick={() => onNavigate("library")}
        />
        <NavItem
          icon="tasks"
          label="Tâches"
          active={currentView === "tasks"}
          onClick={() => onNavigate("tasks")}
          badge={taskOpenCount}
        />
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
            Pas encore de session. Démarre-en une depuis le bouton ci-dessus.
          </div>
        )}
        {sessions.map((s) => {
          const agent = AGENTS[s.agent_id];
          const meta = PROJECT_TYPES[s.project_type];
          const active = currentView === "chat" && s.id === activeSessionId;
          const hovered = hoveredId === s.id;
          return (
            <div
              key={s.id}
              style={{ position: "relative", marginBottom: 2 }}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
                onClick={() => onSelectSession(s.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  gap: 8,
                  padding: hovered ? "8px 34px 8px 10px" : "8px 10px",
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
                  {agent?.emoji ?? "❓"}
                </div>
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
                    {agent?.name} · {formatRelative(s.updated_at)}
                  </div>
                </div>
              </button>

              {hovered && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveSession(s.id);
                  }}
                  title="Archiver"
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
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
              )}
            </div>
          );
        })}

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
                      {agent?.emoji ?? "❓"}
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
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.pink} 0%, ${C.mint} 100%)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "white", fontWeight: 800, fontSize: 11 }}>
              {(userEmail?.[0] ?? "U").toUpperCase()}
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                color: C.text,
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={userEmail}
            >
              {userEmail ?? "Utilisateur"}
            </div>
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
        </div>
      </div>
    </div>
  );
}
