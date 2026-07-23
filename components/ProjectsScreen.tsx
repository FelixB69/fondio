"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AGENTS, AgentId, ChatMessage, PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import {
  computeStats,
  nextStage,
  PROJECT_COLORS,
  PROJECT_ICONS,
  Project,
  ProjectStats,
  STAGES,
  stageIndex,
  stageMeta,
} from "@/lib/projects";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { useTasks } from "@/lib/use-tasks";
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

export interface NewProjectInput {
  name: string;
  icon: string;
  color: string;
  project_type: ProjectType;
}

export function ProjectsScreen({
  onStartSession,
  onOpenSession,
  onOpenProject,
}: {
  onStartSession: (projectId: string, type: ProjectType) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const { tasks } = useTasks();
  const [rawProjects, setRawProjects] = useState<Project[]>([]);
  const [allSessions, setAllSessions] = useState<SessionAggRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [projectsRes, sessionsRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, icon, color, project_type, stage, created_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("sessions")
        .select("id, project_id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .is("archived_at", null)
        .not("project_id", "is", null)
        .order("updated_at", { ascending: false }),
    ]);

    setRawProjects((projectsRes.data ?? []) as Project[]);
    setAllSessions((sessionsRes.data ?? []) as SessionAggRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Tâches issues du cache SWR partagé (useTasks) plutôt que d'un fetch dédié,
  // pour éviter une requête Supabase dupliquée et rester synchro avec les
  // mutations faites depuis les autres écrans.
  const projects = useMemo<ProjectWithStats[]>(() => {
    const sessionToProject = new Map<string, string>();
    for (const s of allSessions) {
      if (s.project_id) sessionToProject.set(s.id, s.project_id);
    }

    return rawProjects.map((p) => {
      const sessions = allSessions.filter((s) => s.project_id === p.id);
      const tasksDone = tasks.filter(
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
  }, [rawProjects, allSessions, tasks]);

  // Renvoie null en cas de succès, sinon un message d'erreur à afficher dans la
  // modale (avant, l'erreur était avalée → le bouton semblait « ne rien faire »).
  const createProject = async (input: NewProjectInput): Promise<string | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "Vous devez être connecté pour créer un projet.";
    const { error } = await supabase.from("projects").insert({
      user_id: user.id,
      name: input.name.trim(),
      icon: input.icon,
      color: input.color,
      project_type: input.project_type,
    });
    if (error) return error.message;
    setShowNew(false);
    load();
    return null;
  };

  const deleteProject = async (id: string) => {
    await supabase.from("projects").delete().eq("id", id);
    setRawProjects((p) => p.filter((x) => x.id !== id));
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
          Regroupez vos sessions sous un projet et suivez votre avancée par paliers.
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
            Créez-en un pour suivre votre progression : {STAGES.map((s) => s.name).join(" → ")}.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => onOpenProject(p.id)}
              onStart={() => onStartSession(p.id, p.project_type)}
              onDelete={() => deleteProject(p.id)}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreate={createProject} />}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onStart,
  onDelete,
  onOpenSession,
}: {
  project: ProjectWithStats;
  onOpen: () => void;
  onStart: () => void;
  onDelete: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const meta = PROJECT_TYPES[project.project_type] ?? PROJECT_TYPES.other;
  const { stats, sessions } = project;
  // L'étape vient du statut stocké (project.stage), plus de l'XP.
  const stage = stageMeta(project.stage);
  const next = nextStage(project.stage);
  const currentIndex = stageIndex(project.stage);

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
        <button
          onClick={onOpen}
          title="Ouvrir le projet"
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
            background: project.color ?? meta.bg,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "pointer",
            padding: 0,
            fontFamily: "inherit",
          }}
        >
          <Icon name={(project.icon ?? "target") as IconName} size={22} color="white" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={onOpen}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              fontSize: 16,
              fontWeight: 800,
              color: C.text,
              letterSpacing: "-0.02em",
              lineHeight: 1.3,
              width: "100%",
            }}
          >
            {project.name}
          </button>
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
            <span style={{ fontWeight: 700, color: stage.color, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name={stage.icon as IconName} size={11} color={stage.color} />
              {stage.name}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
          <button
            onClick={onOpen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: C.white,
              color: C.navy,
              border: `1.5px solid ${C.navy}`,
              borderRadius: 7,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Icon name="tasks" size={11} color={C.navy} />
            Tâches
          </button>
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

      {/* Stepper des palliers */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 12 }}>
        {STAGES.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < STAGES.length - 1 ? 1 : 0 }}>
              <div
                title={s.name}
                style={{
                  width: active ? 32 : 24,
                  height: active ? 32 : 24,
                  borderRadius: "50%",
                  background: done || active ? s.color : C.bg,
                  border: `2px solid ${done || active ? s.color : C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                  boxShadow: active ? `0 0 0 3px ${s.color}25` : "none",
                }}
              >
                {active ? <Icon name={s.icon as IconName} size={14} color="white" /> : done ? <Icon name="check" size={10} color="white" /> : null}
              </div>
              {i < STAGES.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: done ? s.color : C.border,
                    transition: "background 0.2s ease",
                  }}
                />
              )}
            </div>
          );
        })}
        {next && (
          <span style={{ fontSize: 10.5, color: C.textMute, marginLeft: 10, fontWeight: 600, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
            → <Icon name={next.icon as IconName} size={10} color={C.textMute} /> {next.name}
          </span>
        )}
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

export function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: NewProjectInput) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(PROJECT_ICONS[0]);
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [type, setType] = useState<ProjectType>("web");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const err = await onCreate({ name, icon, color, project_type: type });
    setSaving(false);
    if (err) setError(err);
  };

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 200,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: 16,
    overflowY: "auto",
    animation: "fndFadeIn 0.15s ease",
  };

  const modal: CSSProperties = {
    background: C.white,
    borderRadius: 14,
    padding: "20px 22px",
    width: "100%",
    maxWidth: 420,
    margin: "auto",
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

        <Label>Icône</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {PROJECT_ICONS.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              style={{
                width: 36,
                height: 36,
                background: icon === ic ? color : C.bg,
                border: `1.5px solid ${icon === ic ? color : "transparent"}`,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={ic as IconName} size={16} color={icon === ic ? "white" : C.textSub} />
            </button>
          ))}
        </div>

        <Label>Couleur</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: c,
                border: `2.5px solid ${color === c ? C.text : "transparent"}`,
                cursor: "pointer",
                padding: 0,
                fontFamily: "inherit",
              }}
            />
          ))}
        </div>

        <Label>Type</Label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            marginBottom: 18,
          }}
        >
          {(Object.values(PROJECT_TYPES) as Array<typeof PROJECT_TYPES.web>).map((t) => {
            const active = type === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                title={t.name}
                style={{
                  background: active ? t.bg : C.white,
                  border: `1.5px solid ${active ? t.color : C.border}`,
                  borderRadius: 10,
                  padding: "10px 8px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  minWidth: 0,
                  minHeight: 66,
                  textAlign: "center",
                  color: active ? t.color : C.textSub,
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <Icon name={t.icon as IconName} size={18} color={active ? t.color : C.textSub} />
                {t.name}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            style={{
              background: "#FEF0F4",
              border: `1px solid ${C.pink}`,
              color: C.pink,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12.5,
              lineHeight: 1.4,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

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
            disabled={!name.trim() || saving}
            style={{
              background: name.trim() && !saving ? C.navy : C.border,
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: name.trim() && !saving ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            {saving ? "Création…" : "Créer"}
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
