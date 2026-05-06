"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AGENTS, AgentId, ChatMessage, PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import {
  computeStats,
  DEFAULT_EMOJIS,
  Project,
  ProjectStats,
  STAGES,
  XP_RULES,
} from "@/lib/projects";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

interface ProjectSession {
  id: string;
  agent_id: AgentId;
  title: string | null;
  updated_at: string;
  panel_agent_ids?: string[] | null;
}

interface ProjectWithStats extends Project {
  stats: ProjectStats;
  sessions: ProjectSession[];
}

interface SessionAggRow {
  id: string;
  project_id: string | null;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  updated_at: string;
  panel_agent_ids?: string[] | null;
}

interface TaskAggRow {
  id: string;
  status: string;
  session_id: string | null;
}

interface NewProjectInput {
  name: string;
  emoji: string;
  project_type: ProjectType;
}

export function ProjectsScreen({
  onStartSession,
  onOpenSession,
}: {
  onStartSession: (projectId: string, type: ProjectType) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [projectsRes, sessionsRes, tasksRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, emoji, project_type, created_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("sessions")
        .select("id, project_id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .is("archived_at", null)
        .not("project_id", "is", null)
        .order("updated_at", { ascending: false }),
      supabase.from("tasks").select("id, status, session_id"),
    ]);

    const allProjects = (projectsRes.data ?? []) as Project[];
    const allSessions = (sessionsRes.data ?? []) as SessionAggRow[];
    const allTasks = (tasksRes.data ?? []) as TaskAggRow[];

    // session_id -> project_id map (pour rattacher les tâches via leur session)
    const sessionToProject = new Map<string, string>();
    for (const s of allSessions) {
      if (s.project_id) sessionToProject.set(s.id, s.project_id);
    }

    const enriched: ProjectWithStats[] = allProjects.map((p) => {
      const sessions = allSessions.filter((s) => s.project_id === p.id);
      const tasksDone = allTasks.filter(
        (t) => t.status === "done" && t.session_id && sessionToProject.get(t.session_id) === p.id,
      ).length;
      const projectSessions: ProjectSession[] = sessions.map((s) => ({
        id: s.id,
        agent_id: s.agent_id,
        title: s.title,
        updated_at: s.updated_at,
        panel_agent_ids: Array.isArray(s.panel_agent_ids) ? s.panel_agent_ids : null,
      }));
      return { ...p, stats: computeStats(sessions, tasksDone), sessions: projectSessions };
    });

    setProjects(enriched);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const createProject = async (input: NewProjectInput) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("projects").insert({
      user_id: user.id,
      name: input.name.trim(),
      emoji: input.emoji,
      project_type: input.project_type,
    });
    if (!error) {
      setShowNew(false);
      load();
    }
  };

  const deleteProject = async (id: string) => {
    await supabase.from("projects").delete().eq("id", id);
    setProjects((p) => p.filter((x) => x.id !== id));
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        overflow: "hidden",
        animation: "fndFadeIn 0.18s ease",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: isMobile ? "14px 16px 12px" : "20px 28px 16px",
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="target" size={20} color={C.navy} />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
              Projets
            </h1>
          </div>
          <button
            onClick={() => setShowNew(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: C.navy,
              color: "white",
              border: "none",
              borderRadius: 9,
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Icon name="plus" size={12} color="white" />
            Nouveau projet
          </button>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: C.textSub }}>
          Regroupe tes sessions sous un projet et suis ton avancée par paliers.
        </p>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {loading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && projects.length === 0 && (
          <div
            style={{
              marginTop: 60,
              textAlign: "center",
              color: C.textMute,
              fontSize: 14,
              maxWidth: 420,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.6,
            }}
          >
            Pas encore de projet.<br />
            Crée-en un pour suivre ta progression : chaque session, livrable et tâche complétée fait avancer
            ton projet d'un palier ({STAGES.map((s) => s.emoji + " " + s.name).join(" → ")}).
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onStart={() => onStartSession(p.id, p.project_type)}
              onDelete={() => deleteProject(p.id)}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>

        {/* Légende XP en pied de page */}
        {!loading && projects.length > 0 && (
          <div
            style={{
              marginTop: 22,
              padding: "10px 14px",
              background: C.white,
              border: `1px dashed ${C.border}`,
              borderRadius: 10,
              fontSize: 11.5,
              color: C.textSub,
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              justifyContent: "center",
            }}
          >
            <span><b style={{ color: C.text }}>+{XP_RULES.session} XP</b> par session</span>
            <span><b style={{ color: C.text }}>+{XP_RULES.deliverable} XP</b> par livrable</span>
            <span><b style={{ color: C.text }}>+{XP_RULES.taskDone} XP</b> par tâche faite</span>
            <span><b style={{ color: C.text }}>+{XP_RULES.challenger} XP</b> en mode Challenger</span>
          </div>
        )}
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreate={createProject} />}
    </div>
  );
}

function ProjectCard({
  project,
  onStart,
  onDelete,
  onOpenSession,
}: {
  project: ProjectWithStats;
  onStart: () => void;
  onDelete: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const meta = PROJECT_TYPES[project.project_type];
  const { stats, sessions } = project;
  const { stage, nextStage, progressToNext, xp } = stats;

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "16px 18px",
        boxShadow: C.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
            background: meta.bg,
            border: `1.5px solid ${meta.color}25`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {project.emoji ?? "🎯"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: C.text,
              letterSpacing: "-0.02em",
              lineHeight: 1.3,
            }}
          >
            {project.name}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: C.textSub,
              marginTop: 3,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: meta.color, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name={meta.icon as IconName} size={11} color={meta.color} />
              {meta.name}
            </span>
            <span style={{ color: C.textMute }}>·</span>
            <span style={{ fontWeight: 700, color: stage.color }}>
              {stage.emoji} {stage.name}
            </span>
            <span style={{ color: C.textMute }}>·</span>
            <span style={{ fontWeight: 700, color: C.text }}>{xp} XP</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={onStart}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: C.navy,
              color: "white",
              border: "none",
              borderRadius: 7,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Icon name="plus" size={11} color="white" />
            Session
          </button>
          <button
            onClick={() => {
              if (confirmDelete) onDelete();
              else setConfirmDelete(true);
            }}
            onBlur={() => setConfirmDelete(false)}
            title={confirmDelete ? "Confirmer la suppression" : "Supprimer le projet"}
            style={{
              background: confirmDelete ? "#FEF0F4" : C.bg,
              color: confirmDelete ? C.pink : C.textMute,
              border: `1px solid ${confirmDelete ? C.pink : C.border}`,
              borderRadius: 7,
              padding: "6px 9px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="trash" size={11} color={confirmDelete ? C.pink : C.textMute} />
            {confirmDelete && <span>Confirmer</span>}
          </button>
        </div>
      </div>

      {/* Progress bar vers le prochain palier */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            color: C.textSub,
            marginBottom: 5,
            fontWeight: 600,
          }}
        >
          <span>
            {nextStage
              ? <>Vers <b style={{ color: nextStage.color }}>{nextStage.emoji} {nextStage.name}</b></>
              : <b style={{ color: stage.color }}>Niveau max atteint 🏆</b>}
          </span>
          {nextStage && (
            <span style={{ color: C.textMute }}>
              {xp} / {nextStage.minXp} XP
            </span>
          )}
        </div>
        <div
          style={{
            height: 7,
            background: C.bg,
            borderRadius: 100,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progressToNext}%`,
              height: "100%",
              background: nextStage
                ? `linear-gradient(90deg, ${stage.color}, ${nextStage.color})`
                : `linear-gradient(90deg, ${C.mint}, ${stage.color})`,
              borderRadius: 100,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
        }}
      >
        <Stat label="Sessions" value={stats.sessionsCount} />
        <Stat label="Livrables" value={stats.deliverablesCount} />
        <Stat label="Tâches" value={stats.tasksDoneCount} />
        <Stat label="Challenges" value={stats.challengerSessionsCount} />
      </div>

      {/* Sessions du projet, dépliables */}
      {sessions.length > 0 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 2px",
              fontSize: 11.5,
              fontWeight: 700,
              color: C.textSub,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            <Icon name={expanded ? "chevDown" : "chevRight"} size={11} color={C.textSub} />
            <span style={{ flex: 1, textAlign: "left" }}>
              Sessions ({sessions.length})
            </span>
          </button>

          {expanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {sessions.map((s) => {
                const isPanel = Array.isArray(s.panel_agent_ids) && s.panel_agent_ids.length > 1;
                const agent = AGENTS[s.agent_id];
                return (
                  <button
                    key={s.id}
                    onClick={() => onOpenSession(s.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "8px 10px",
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      transition: "background 0.12s, border-color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = C.navyLight;
                      e.currentTarget.style.borderColor = C.navyMid;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = C.bg;
                      e.currentTarget.style.borderColor = C.border;
                    }}
                  >
                    {isPanel ? (
                      <div style={{ display: "flex", flexShrink: 0 }}>
                        {(s.panel_agent_ids ?? []).slice(0, 3).map((id, i) => (
                          <div
                            key={id}
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              background: AGENTS[id as AgentId]?.bg ?? C.bg,
                              border: "1.5px solid white",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginLeft: i > 0 ? -7 : 0,
                              position: "relative",
                              zIndex: 3 - i,
                            }}
                          >
                            <Icon
                              name={(AGENTS[id as AgentId]?.icon ?? "sparkles") as IconName}
                              size={11}
                              color={AGENTS[id as AgentId]?.color ?? C.text}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
                          background: agent?.bg ?? C.bg,
                          border: `1.5px solid ${agent?.color ?? C.border}25`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon name={(agent?.icon ?? "sparkles") as IconName} size={13} color={agent?.color ?? C.text} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: C.text,
                          lineHeight: 1.3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.title ?? "Nouvelle session"}
                      </div>
                      <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                        {isPanel ? `Panel · ${s.panel_agent_ids?.length} agents` : agent?.name} · {formatRelative(s.updated_at)}
                      </div>
                    </div>
                    <Icon name="chevRight" size={12} color={C.textMute} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  return new Date(iso).toLocaleDateString("fr-FR");
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: C.bg,
        borderRadius: 8,
        padding: "8px 10px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: C.textMute, fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: NewProjectInput) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const [type, setType] = useState<ProjectType>("perso");

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name, emoji, project_type: type });
  };

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    animation: "fndFadeIn 0.15s ease",
  };

  const modal: CSSProperties = {
    background: C.white,
    borderRadius: 14,
    padding: "20px 22px",
    width: "100%",
    maxWidth: 420,
    boxShadow: C.shadowMd,
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Nouveau projet
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.textMute, display: "flex" }}
          >
            <Icon name="close" size={16} color={C.textMute} />
          </button>
        </div>

        <Label>Nom du projet</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Ex : Lancer mon side project"
          autoFocus
          style={{
            width: "100%",
            padding: "9px 12px",
            border: `1.5px solid ${C.border}`,
            borderRadius: 9,
            fontSize: 13.5,
            fontFamily: "inherit",
            color: C.text,
            outline: "none",
            marginBottom: 14,
            boxSizing: "border-box",
          }}
        />

        <Label>Emoji</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {DEFAULT_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              style={{
                width: 36,
                height: 36,
                fontSize: 20,
                background: emoji === e ? C.navyLight : C.bg,
                border: `1.5px solid ${emoji === e ? C.navy : "transparent"}`,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {e}
            </button>
          ))}
        </div>

        <Label>Type</Label>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {(Object.values(PROJECT_TYPES) as Array<typeof PROJECT_TYPES.perso>).map((t) => {
            const active = type === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                style={{
                  flex: 1,
                  background: active ? t.bg : C.white,
                  border: `1.5px solid ${active ? t.color : C.border}`,
                  borderRadius: 9,
                  padding: "9px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  color: active ? t.color : C.textSub,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <Icon name={t.icon as IconName} size={14} color={active ? t.color : C.textSub} />
                {t.name}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              background: C.white,
              color: C.textSub,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            style={{
              background: name.trim() ? C.navy : C.border,
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: name.trim() ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: C.textSub,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
