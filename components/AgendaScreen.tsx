"use client";

import { useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, Task, TaskPriority } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { useTasks } from "@/lib/use-tasks";
import {
  AgendaBucket,
  agendaBucket,
  AGENDA_BUCKETS,
  AgendaFilters,
  compareTasks,
  dueDateMeta,
  EMPTY_AGENDA_FILTERS,
  hasActiveFilters,
  matchesAgenda,
  PRIORITY_META,
} from "@/lib/tasks";
import { AgendaTimeline, ProjectLite } from "./AgendaTimeline";
import { Icon, IconName } from "./Icon";
import { Badge, EditableContent, TaskControls } from "./TaskBits";
import { TaskDetailModal } from "./TaskDetailModal";

type AgendaView = "timeline" | "list";

export function AgendaScreen({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const isMobile = useIsMobile();
  const supabase = useMemo(() => createClient(), []);
  const [projects, setProjects] = useState<Record<string, ProjectLite>>({});
  const [view, setView] = useState<AgendaView>(isMobile ? "list" : "timeline");
  const [filters, setFilters] = useState<AgendaFilters>(EMPTY_AGENDA_FILTERS);
  // Tâche ouverte dans la popup d'édition. On garde l'id (pas l'objet) pour que
  // la popup reflète les mises à jour optimistes en relisant depuis `tasks`.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Tâches via le cache SWR partagé (mêmes données que les écrans Tâches/Projet) :
  // un seul fetch réseau, et toute mutation s'y répercute instantanément.
  const {
    tasks,
    loading,
    addTask,
    setStatus,
    removeTask,
    setPriority,
    setDueDate,
    setStartDate,
    setContent,
    shiftDates,
    addComment,
    editComment,
    deleteComment,
  } = useTasks();

  // Les projets servent aux libellés et aux filtres ; chargés une seule fois.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("projects").select("id, name, icon, color");
      if (cancelled) return;
      const map: Record<string, ProjectLite> = {};
      for (const p of (data ?? []) as ProjectLite[]) map[p.id] = p;
      setProjects(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => tasks.filter((t) => matchesAgenda(t, filters)), [tasks, filters]);
  const editingTask = useMemo(() => tasks.find((t) => t.id === editingTaskId) ?? null, [tasks, editingTaskId]);

  // Vue Liste : regroupement par horizon (les tâches « done » sortent via agendaBucket).
  const buckets = useMemo(() => {
    const b: Record<AgendaBucket, Task[]> = { overdue: [], today: [], week: [], later: [], nodate: [] };
    for (const t of filtered) {
      const id = agendaBucket(t);
      if (id) b[id].push(t);
    }
    for (const id of Object.keys(b) as AgendaBucket[]) b[id].sort(compareTasks);
    return b;
  }, [filtered]);

  // En-tête : compteurs sur l'ensemble (non filtré) pour rester stables.
  const openTasks = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);
  const overdueCount = useMemo(() => openTasks.filter((t) => agendaBucket(t) === "overdue").length, [openTasks]);
  const todayCount = useMemo(() => openTasks.filter((t) => agendaBucket(t) === "today").length, [openTasks]);

  // Options de filtre dérivées des tâches présentes.
  const projectOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) if (t.project_id) ids.add(t.project_id);
    return [...ids].map((id) => projects[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, projects]);
  const agentOptions = useMemo(() => {
    const ids = new Set<AgentId>();
    for (const t of tasks) if (t.source_agent_id) ids.add(t.source_agent_id);
    return [...ids];
  }, [tasks]);

  // setStatus / setPriority / setDueDate / setStartDate / setContent / shiftDates /
  // removeTask / addTask viennent de useTasks (optimistic + cache partagé).
  // Alias locaux conservant l'API attendue par le JSX et la popup d'édition.
  const complete = (task: Task) => setStatus(task, "done");
  const deleteTask = (task: Task) => {
    setEditingTaskId(null);
    return removeTask(task);
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
      <div style={{ padding: isMobile ? "14px 16px 12px" : "20px 28px 16px", background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Icon name="clock" size={20} color={C.navy} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>Agenda</h1>
          <div style={{ marginLeft: "auto" }}>
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: C.textSub }}>
          {overdueCount > 0 ? (
            <>
              <span style={{ color: "#DC2626", fontWeight: 700 }}>{overdueCount} en retard</span>
              {" · "}
            </>
          ) : null}
          {todayCount > 0 ? <span style={{ fontWeight: 600 }}>{todayCount} aujourd'hui</span> : "Planifiez vos tâches, tous projets confondus."}
        </p>

        {/* Barre de filtres */}
        {!loading && tasks.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            <SearchInput value={filters.query} onChange={(query) => setFilters((f) => ({ ...f, query }))} />
            <FilterSelect
              value={filters.projectId ?? ""}
              onChange={(v) => setFilters((f) => ({ ...f, projectId: v || null }))}
              placeholder="Tous les projets"
              options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
            />
            {agentOptions.length > 0 && (
              <FilterSelect
                value={filters.agentId ?? ""}
                onChange={(v) => setFilters((f) => ({ ...f, agentId: v || null }))}
                placeholder="Tous les agents"
                options={agentOptions.map((id) => ({ value: id, label: AGENTS[id]?.name ?? id }))}
              />
            )}
            <ToggleChip
              active={filters.showDone}
              label="Terminées"
              icon="check"
              onClick={() => setFilters((f) => ({ ...f, showDone: !f.showDone }))}
            />
            {hasActiveFilters(filters) && (
              <button
                onClick={() => setFilters(EMPTY_AGENDA_FILTERS)}
                style={{ background: "none", border: "none", color: C.textSub, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Icon name="close" size={11} color={C.textSub} />
                Réinitialiser
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {loading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && tasks.length === 0 && (
          <EmptyState text="Rien à l'agenda. Créez une tâche depuis l'écran Tâches, un projet, ou convertissez un livrable depuis le chat." />
        )}

        {!loading && tasks.length > 0 && filtered.length === 0 && (
          <EmptyState text="Aucune tâche ne correspond à ces filtres." />
        )}

        {!loading && filtered.length > 0 && view === "timeline" && (
          <AgendaTimeline
            tasks={filtered}
            projects={projects}
            onShiftDates={shiftDates}
            onSetStart={setStartDate}
            onSetDue={setDueDate}
            onSetContent={setContent}
            onComplete={complete}
            onAddTask={addTask}
            onOpenSession={onOpenSession}
            onOpenTask={(task) => setEditingTaskId(task.id)}
          />
        )}

        {!loading && filtered.length > 0 && view === "list" && (
          <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 22 }}>
            {AGENDA_BUCKETS.map((bucket) => {
              const items = buckets[bucket.id];
              if (items.length === 0) return null;
              return (
                <div key={bucket.id}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      marginBottom: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      color: bucket.color,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    <Icon name={bucket.icon} size={13} color={bucket.color} />
                    {bucket.label}
                    <span style={{ color: C.textMute, fontWeight: 700 }}>· {items.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map((task) => (
                      <AgendaRow
                        key={task.id}
                        task={task}
                        project={task.project_id ? projects[task.project_id] : undefined}
                        onComplete={() => complete(task)}
                        onSetPriority={(p) => setPriority(task, p)}
                        onSetStart={(d) => setStartDate(task, d)}
                        onSetDue={(d) => setDueDate(task, d)}
                        onSetContent={(c) => setContent(task, c)}
                        onOpenSession={onOpenSession}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Popup d'édition (ouverte au clic sur une barre de la timeline) */}
      {editingTask && (
        <TaskDetailModal
          key={editingTask.id}
          task={editingTask}
          project={editingTask.project_id ? projects[editingTask.project_id] : undefined}
          onClose={() => setEditingTaskId(null)}
          onSetStatus={(s) => setStatus(editingTask, s)}
          onSetPriority={(p) => setPriority(editingTask, p)}
          onSetStart={(d) => setStartDate(editingTask, d)}
          onSetDue={(d) => setDueDate(editingTask, d)}
          onSetContent={(c) => setContent(editingTask, c)}
          onAddComment={(content) => addComment(editingTask, content)}
          onEditComment={(commentId, content) => editComment(editingTask, commentId, content)}
          onDeleteComment={(commentId) => deleteComment(editingTask, commentId)}
          onDelete={() => deleteTask(editingTask)}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Briques d'UI locales
// --------------------------------------------------------------------------

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 60, textAlign: "center", color: C.textMute, fontSize: 14, maxWidth: 380, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
      {text}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: AgendaView; onChange: (v: AgendaView) => void }) {
  const buttons: Array<{ id: AgendaView; label: string; icon: IconName }> = [
    { id: "timeline", label: "Timeline", icon: "chart" },
    { id: "list", label: "Liste", icon: "tasks" },
  ];
  return (
    <div style={{ display: "flex", background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: 3, gap: 2 }}>
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

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "5px 10px" }}>
      <Icon name="search" size={12} color={C.textMute} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher…"
        style={{ border: "none", outline: "none", background: "transparent", fontSize: 12.5, color: C.text, fontFamily: "inherit", width: 130 }}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  const active = value !== "";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: active ? C.navyLight : C.white,
        color: active ? C.navy : C.textSub,
        border: `1.5px solid ${active ? C.navyMid : C.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ToggleChip({ active, label, icon, onClick }: { active: boolean; label: string; icon: IconName; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: active ? C.navy : C.white,
        color: active ? "white" : C.textSub,
        border: `1.5px solid ${active ? C.navy : C.border}`,
        borderRadius: 100,
        padding: "5px 11px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <Icon name={icon} size={11} color={active ? "white" : C.textSub} />
      {label}
    </button>
  );
}

function AgendaRow({
  task,
  project,
  onComplete,
  onSetPriority,
  onSetStart,
  onSetDue,
  onSetContent,
  onOpenSession,
}: {
  task: Task;
  project?: ProjectLite;
  onComplete: () => void;
  onSetPriority: (p: TaskPriority) => void;
  onSetStart: (d: string | null) => void;
  onSetDue: (d: string | null) => void;
  onSetContent: (c: string) => void;
  onOpenSession: (id: string) => void;
}) {
  const agent = task.source_agent_id ? AGENTS[task.source_agent_id as AgentId] : null;
  const prio = PRIORITY_META[task.priority];
  const due = task.due_date ? dueDateMeta(task.due_date, false) : null;
  const projColor = project?.color ?? C.navy;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <button
        onClick={onComplete}
        title="Marquer comme fait"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "transparent",
          border: `1.5px solid ${C.mint}`,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
          marginTop: 1,
        }}
      >
        <Icon name="check" size={11} color={C.mint} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <EditableContent task={task} done={false} fontSize={13.5} onSave={onSetContent} />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
          {project && (
            <Badge label={project.name} color={projColor} bg={`${projColor}14`} icon={(project.icon ?? "target") as IconName} />
          )}
          {prio && <Badge label={prio.label} color={prio.color} bg={prio.bg} icon={task.priority === "high" ? "warning" : undefined} />}
          {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
          {agent && task.session_id && (
            <button
              onClick={() => onOpenSession(task.session_id!)}
              title={`Ouvrir la session · ${agent.name}`}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: agent.color, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, fontFamily: "inherit" }}
            >
              <Icon name={agent.icon as IconName} size={10} color={agent.color} />
              <Icon name="externalLink" size={9} color={agent.color} />
            </button>
          )}
        </div>
      </div>
      <TaskControls task={task} onSetPriority={onSetPriority} onSetStart={onSetStart} onSetDue={onSetDue} />
    </div>
  );
}
