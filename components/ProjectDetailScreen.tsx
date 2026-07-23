"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, ChatMessage, PROJECT_TYPES, ProjectType, Task, TaskPriority, TaskStatus } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { computeStats, Project, ProjectStats, STAGES, StageId } from "@/lib/projects";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { useTasks } from "@/lib/use-tasks";
import {
  compareTasks,
  dueDateMeta,
  FILTERS,
  filterCounts,
  matchesFilter,
  NEXT_STATUS,
  PRIORITY_META,
  STATUS_META,
  STATUS_ORDER,
  TaskFilter,
} from "@/lib/tasks";
import { Icon, IconName } from "./Icon";
import { Badge, EditableContent, FilterChips, TaskControls } from "./TaskBits";

type ViewMode = "list" | "kanban";

interface SessionRow {
  id: string;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  updated_at: string;
  panel_agent_ids?: string[] | null;
}

export function ProjectDetailScreen({
  projectId,
  onBack,
  onOpenSession,
  onStartSession,
}: {
  projectId: string;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
  onStartSession: (projectId: string, type: ProjectType) => void;
}) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState("");
  const [view, setView] = useState<ViewMode>(isMobile ? "list" : "kanban");
  const [filter, setFilter] = useState<TaskFilter>("all");

  // Tâches du projet via le cache SWR global (filtré côté client sur project_id) :
  // partagé avec les écrans Tâches/Agenda, et addTask rattache au projet courant.
  const {
    tasks,
    loading: tasksLoading,
    addTask: createTask,
    cycleStatus,
    setStatus,
    removeTask,
    setPriority,
    setDueDate,
    setStartDate,
    setContent,
  } = useTasks({ projectId });

  // Indicateur de chargement unique : projet + sessions + tâches.
  const loading = projectLoading || tasksLoading;

  const load = useCallback(async () => {
    setProjectLoading(true);
    const [projRes, sessRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, icon, color, project_type, stage, created_at, updated_at")
        .eq("id", projectId)
        .single(),
      supabase
        .from("sessions")
        .select("id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .eq("project_id", projectId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false }),
    ]);
    setProject((projRes.data as Project) ?? null);
    setSessions((sessRes.data ?? []) as SessionRow[]);
    setProjectLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleTasks = useMemo(() => tasks.filter((t) => matchesFilter(t, filter)), [tasks, filter]);

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of visibleTasks) g[t.status].push(t);
    for (const status of STATUS_ORDER) g[status].sort(compareTasks);
    return g;
  }, [visibleTasks]);

  // Compteurs des chips — sur l'ensemble complet, indépendamment du filtre actif.
  const counts = useMemo(() => filterCounts(tasks), [tasks]);

  // doneCount / progress / stats sont calculés sur TOUTES les tâches (pas le
  // sous-ensemble filtré) pour rester stables quand on change de filtre.
  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);

  const progress = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((doneCount / tasks.length) * 100);
  }, [tasks, doneCount]);

  const stats: ProjectStats | null = useMemo(() => {
    if (!project) return null;
    return computeStats(sessions, doneCount);
  }, [project, sessions, doneCount]);

  const updateStage = async (stage: StageId) => {
    await supabase.from("projects").update({ stage }).eq("id", projectId);
    setProject((p) => (p ? { ...p, stage } : null));
  };

  // Création depuis le champ rapide ; le rattachement au projet est géré par useTasks
  // (scope projectId). Les autres mutations viennent directement du hook.
  const addTask = async () => {
    const text = newTaskText.trim();
    if (!text) return;
    const created = await createTask({ content: text });
    if (created) setNewTaskText("");
  };

  if (!loading && !project) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMute, fontSize: 14 }}>
        Projet introuvable.{" "}
        <button
          onClick={onBack}
          style={{ marginLeft: 8, background: "none", border: "none", color: C.navy, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}
        >
          Retour
        </button>
      </div>
    );
  }

  const meta = project ? (PROJECT_TYPES[project.project_type] ?? PROJECT_TYPES.other) : null;
  const currentStageIndex = project ? STAGES.findIndex((s) => s.id === project.stage) : 0;

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
          padding: isMobile ? "12px 16px 12px" : "18px 28px 16px",
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: C.textSub,
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            padding: "2px 0 8px",
          }}
        >
          <Icon name="arrowLeft" size={13} color={C.textSub} />
          Tous les projets
        </button>

        {project && meta && stats && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
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
                <Icon name={(project.icon ?? "target") as IconName} size={22} color="white" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: C.text,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.25,
                  }}
                >
                  {project.name}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.textSub,
                    marginTop: 4,
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
                  {tasks.length > 0 && (
                    <>
                      <span style={{ color: C.textMute }}>·</span>
                      <span style={{ fontWeight: 600, color: C.textSub }}>
                        {grouped.done.length} / {tasks.length} tâches · {progress}%
                      </span>
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={() => onStartSession(project.id, project.project_type)}
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
                  flexShrink: 0,
                }}
              >
                <Icon name="plus" size={12} color="white" />
                Session
              </button>
            </div>

            {/* Stepper des palliers */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 14 }}>
              {STAGES.map((s, i) => {
                const done = i < currentStageIndex;
                const active = i === currentStageIndex;
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < STAGES.length - 1 ? 1 : 0 }}>
                    <button
                      onClick={() => updateStage(s.id)}
                      title={s.name}
                      style={{
                        width: active ? 30 : 22,
                        height: active ? 30 : 22,
                        borderRadius: "50%",
                        background: done || active ? s.color : C.bg,
                        border: `2px solid ${done || active ? s.color : C.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: active ? 13 : 10,
                        cursor: "pointer",
                        padding: 0,
                        flexShrink: 0,
                        transition: "all 0.15s ease",
                        boxShadow: active ? `0 0 0 3px ${s.color}25` : "none",
                      }}
                    >
                      {active ? <Icon name={s.icon as IconName} size={13} color="white" /> : done ? <Icon name="check" size={9} color="white" /> : null}
                    </button>
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
              <span style={{ fontSize: 10.5, color: stats.stage.color, marginLeft: 10, fontWeight: 700, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name={stats.stage.icon as IconName} size={11} color={stats.stage.color} /> {stats.stage.name}
              </span>
            </div>

            {/* Progress bar tâches */}
            {tasks.length > 0 && (
              <div
                style={{
                  height: 5,
                  background: C.bg,
                  borderRadius: 100,
                  overflow: "hidden",
                  margin: "14px 0 12px",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${C.navy}, ${C.mint})`,
                    borderRadius: 100,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            )}

            {/* Quick add + view toggle */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: tasks.length > 0 ? 0 : 14,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  minWidth: 220,
                  gap: 8,
                  background: C.bg,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                }}
              >
                <input
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTask();
                  }}
                  placeholder="Nouvelle tâche pour ce projet…"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: 13.5,
                    color: C.text,
                    fontFamily: "inherit",
                    minWidth: 0,
                  }}
                />
                <button
                  onClick={addTask}
                  disabled={!newTaskText.trim()}
                  style={{
                    background: newTaskText.trim() ? C.navy : C.border,
                    color: "white",
                    border: "none",
                    borderRadius: 7,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: newTaskText.trim() ? "pointer" : "default",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Icon name="plus" size={11} color="white" />
                  Ajouter
                </button>
              </div>

              <ViewToggle view={view} onChange={setView} />
            </div>

            {/* Barre de filtres */}
            {tasks.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <FilterChips filters={FILTERS} active={filter} counts={counts} onChange={setFilter} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {loading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && tasks.length === 0 && (
          <div
            style={{
              marginTop: 40,
              textAlign: "center",
              color: C.textMute,
              fontSize: 14,
              maxWidth: 420,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.6,
            }}
          >
            Pas encore de tâche pour ce projet.<br />
            Ajoutez-en une ci-dessus, ou convertissez un livrable depuis une session.
          </div>
        )}

        {!loading && tasks.length > 0 && view === "kanban" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
              gap: 16,
            }}
          >
            {STATUS_ORDER.map((status) => {
              const meta = STATUS_META[status];
              const items = grouped[status];
              return (
                <div
                  key={status}
                  style={{
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minHeight: 140,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "2px 4px 6px",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 800,
                        color: meta.color,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
                      {meta.label}
                    </div>
                    <span style={{ fontSize: 11, color: C.textMute, fontWeight: 700 }}>{items.length}</span>
                  </div>
                  {items.length === 0 && (
                    <div style={{ fontSize: 12, color: C.textMute, padding: "10px 4px" }}>Vide.</div>
                  )}
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onCycle={() => cycleStatus(task)}
                      onSetStatus={(s) => setStatus(task, s)}
                      onSetPriority={(p) => setPriority(task, p)}
                      onSetDue={(d) => setDueDate(task, d)}
                      onSetStart={(d) => setStartDate(task, d)}
                      onSetContent={(c) => setContent(task, c)}
                      onDelete={() => removeTask(task)}
                      onOpenSession={onOpenSession}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {!loading && tasks.length > 0 && view === "list" && (
          <div
            style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {STATUS_ORDER.map((status) =>
              grouped[status].length === 0 ? null : (
                <div key={status}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 8px 4px",
                      fontSize: 11,
                      fontWeight: 800,
                      color: STATUS_META[status].color,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_META[status].color }} />
                    {STATUS_META[status].label}
                    <span style={{ color: C.textMute, fontWeight: 700, marginLeft: 2 }}>· {grouped[status].length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {grouped[status].map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onCycle={() => cycleStatus(task)}
                        onSetStatus={(s) => setStatus(task, s)}
                        onSetPriority={(p) => setPriority(task, p)}
                        onSetDue={(d) => setDueDate(task, d)}
                        onSetStart={(d) => setStartDate(task, d)}
                        onSetContent={(c) => setContent(task, c)}
                        onDelete={() => removeTask(task)}
                        onOpenSession={onOpenSession}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* Sessions du projet */}
        {!loading && sessions.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                fontSize: 12,
                fontWeight: 800,
                color: C.textSub,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              <Icon name="msgSquare" size={12} color={C.textSub} />
              Sessions ({sessions.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                      gap: 10,
                      padding: "10px 12px",
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
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
                      e.currentTarget.style.background = C.white;
                      e.currentTarget.style.borderColor = C.border;
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: agent?.bg ?? C.bg,
                        border: `1.5px solid ${(agent?.color ?? C.border)}25`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={(agent?.icon ?? "sparkles") as IconName} size={13} color={agent?.color ?? C.text} />
                    </div>
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
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const buttons: Array<{ id: ViewMode; label: string; icon: IconName }> = [
    { id: "list", label: "Liste", icon: "tasks" },
    { id: "kanban", label: "Kanban", icon: "chart" },
  ];
  return (
    <div
      style={{
        display: "flex",
        background: C.bg,
        border: `1.5px solid ${C.border}`,
        borderRadius: 10,
        padding: 3,
        gap: 2,
        flexShrink: 0,
      }}
    >
      {buttons.map((b) => {
        const active = view === b.id;
        return (
          <button
            key={b.id}
            onClick={() => onChange(b.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: active ? C.white : "transparent",
              color: active ? C.text : C.textSub,
              border: active ? `1px solid ${C.border}` : "1px solid transparent",
              borderRadius: 7,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              boxShadow: active ? C.shadow : "none",
            }}
          >
            <Icon name={b.icon} size={12} color={active ? C.text : C.textSub} />
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  onCycle,
  onSetPriority,
  onSetDue,
  onSetStart,
  onSetContent,
  onDelete,
  onOpenSession,
}: {
  task: Task;
  onCycle: () => void;
  onSetStatus: (s: TaskStatus) => void;
  onSetPriority: (p: TaskPriority) => void;
  onSetDue: (d: string | null) => void;
  onSetStart: (d: string | null) => void;
  onSetContent: (c: string) => void;
  onDelete: () => void;
  onOpenSession: (id: string) => void;
}) {
  const meta = STATUS_META[task.status];
  const status = task.status;
  const agent = task.source_agent_id ? AGENTS[task.source_agent_id as AgentId] : null;
  const prio = PRIORITY_META[task.priority];
  const due = task.due_date ? dueDateMeta(task.due_date, status === "done") : null;
  return (
    <div
      style={{
        background: meta.bg,
        border: `1px solid ${meta.color}28`,
        borderRadius: 9,
        padding: "9px 11px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      <EditableContent task={task} done={status === "done"} fontSize={13} onSave={onSetContent} />
      {(prio || due) && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {prio && <Badge label={prio.label} color={prio.color} bg={prio.bg} icon={task.priority === "high" ? "warning" : undefined} />}
          {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
        </div>
      )}
      {agent && (
        <div
          style={{
            fontSize: 10.5,
            color: agent.color,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Icon name={agent.icon as IconName} size={10} color={agent.color} />
          {agent.name}
          {task.session_id && (
            <button
              onClick={() => onOpenSession(task.session_id!)}
              title="Ouvrir la session source"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                marginLeft: 4,
                color: agent.color,
                display: "flex",
              }}
            >
              <Icon name="externalLink" size={10} color={agent.color} />
            </button>
          )}
        </div>
      )}
      <TaskControls task={task} onSetPriority={onSetPriority} onSetStart={onSetStart} onSetDue={onSetDue} />
      <div style={{ display: "flex", gap: 5 }}>
        <button
          onClick={onCycle}
          title={`Passer à : ${STATUS_META[NEXT_STATUS[status]].label}`}
          style={{
            flex: 1,
            background: C.white,
            color: meta.color,
            border: `1px solid ${meta.color}40`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          {status === "done" ? (
            <>
              <Icon name="refresh" size={10} color={meta.color} />
              Rouvrir
            </>
          ) : (
            <>
              <Icon name="chevRight" size={10} color={meta.color} />
              {STATUS_META[NEXT_STATUS[status]].label}
            </>
          )}
        </button>
        <button
          onClick={onDelete}
          title="Supprimer"
          style={{
            background: C.white,
            color: C.textMute,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
          }}
        >
          <Icon name="close" size={10} color={C.textMute} />
        </button>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onCycle,
  onSetStatus,
  onSetPriority,
  onSetDue,
  onSetStart,
  onSetContent,
  onDelete,
  onOpenSession,
}: {
  task: Task;
  onCycle: () => void;
  onSetStatus: (s: TaskStatus) => void;
  onSetPriority: (p: TaskPriority) => void;
  onSetDue: (d: string | null) => void;
  onSetStart: (d: string | null) => void;
  onSetContent: (c: string) => void;
  onDelete: () => void;
  onOpenSession: (id: string) => void;
}) {
  const meta = STATUS_META[task.status];
  const status = task.status;
  const agent = task.source_agent_id ? AGENTS[task.source_agent_id as AgentId] : null;
  const prio = PRIORITY_META[task.priority];
  const due = task.due_date ? dueDateMeta(task.due_date, status === "done") : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: status === "done" ? C.bg : C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <button
        onClick={onCycle}
        title={`Passer à : ${STATUS_META[NEXT_STATUS[status]].label}`}
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: status === "done" ? meta.color : "transparent",
          border: `1.5px solid ${meta.color}`,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
        }}
      >
        {status === "done" && <Icon name="check" size={11} color="white" />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <EditableContent task={task} done={status === "done"} fontSize={13.5} onSave={onSetContent} />
        {(prio || due) && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
            {prio && <Badge label={prio.label} color={prio.color} bg={prio.bg} icon={task.priority === "high" ? "warning" : undefined} />}
            {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
          </div>
        )}
        {agent && (
          <div
            style={{
              fontSize: 10.5,
              color: agent.color,
              fontWeight: 600,
              marginTop: 2,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name={agent.icon as IconName} size={10} color={agent.color} />
            {agent.name}
            {task.session_id && (
              <button
                onClick={() => onOpenSession(task.session_id!)}
                title="Ouvrir la session source"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  marginLeft: 2,
                  color: agent.color,
                  display: "flex",
                }}
              >
                <Icon name="externalLink" size={10} color={agent.color} />
              </button>
            )}
          </div>
        )}
      </div>
      <TaskControls task={task} onSetPriority={onSetPriority} onSetStart={onSetStart} onSetDue={onSetDue} />
      <select
        value={status}
        onChange={(e) => onSetStatus(e.target.value as TaskStatus)}
        style={{
          background: meta.bg,
          color: meta.color,
          border: `1px solid ${meta.color}40`,
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
      <button
        onClick={onDelete}
        title="Supprimer"
        style={{
          background: C.white,
          color: C.textMute,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
        }}
      >
        <Icon name="close" size={11} color={C.textMute} />
      </button>
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
