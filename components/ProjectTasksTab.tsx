"use client";

// Onglet « Tâches » de l'écran projet : création rapide, filtres, board Kanban
// ou Liste. Extrait de ProjectDetailScreen — le code est déplacé tel quel, à
// l'exception du défaut Liste/Kanban sur mobile (voir plus bas).
//
// Les tâches viennent de `useTasks({ projectId })`, c'est-à-dire du cache SWR
// partagé par toute l'application : l'appeler ici en plus du parent ne coûte
// aucune requête supplémentaire.
import { useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, Task, TaskPriority, TaskStatus } from "@/lib/data";
import { C } from "@/lib/design-tokens";
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

export function ProjectTasksTab({
  projectId,
  filter,
  onFilterChange,
  onOpenSession,
}: {
  projectId: string;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const isMobile = useIsMobile();
  const [newTaskText, setNewTaskText] = useState("");
  const [view, setView] = useState<ViewMode>("kanban");

  // `useIsMobile` renvoie false au premier rendu (l'état est calculé dans un
  // effet), donc initialiser `view` avec sa valeur ne marcherait jamais. On
  // règle la vue par défaut dans un effet. Contrepartie assumée : franchir le
  // point de rupture en redimensionnant réécrase un choix manuel.
  useEffect(() => {
    setView(isMobile ? "list" : "kanban");
  }, [isMobile]);

  const {
    tasks,
    loading,
    addTask: createTask,
    cycleStatus,
    setStatus,
    removeTask,
    setPriority,
    setDueDate,
    setStartDate,
    setContent,
  } = useTasks({ projectId });

  const visibleTasks = useMemo(() => tasks.filter((t) => matchesFilter(t, filter)), [tasks, filter]);

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of visibleTasks) g[t.status].push(t);
    for (const status of STATUS_ORDER) g[status].sort(compareTasks);
    return g;
  }, [visibleTasks]);

  // Compteurs des chips — sur l'ensemble complet, indépendamment du filtre actif.
  const counts = useMemo(() => filterCounts(tasks), [tasks]);

  // Création depuis le champ rapide ; le rattachement au projet est géré par useTasks
  // (scope projectId). Les autres mutations viennent directement du hook.
  const addTask = async () => {
    const text = newTaskText.trim();
    if (!text) return;
    const created = await createTask({ content: text });
    if (created) setNewTaskText("");
  };

  return (
    <>
      {/* Quick add + view toggle */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex",
            flex: 1,
            minWidth: 220,
            gap: 8,
            background: C.white,
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
            placeholder="Nouvelle action pour ce projet : Appeler…, Rédiger…"
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
          <FilterChips filters={FILTERS} active={filter} counts={counts} onChange={onFilterChange} />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
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
      </div>
    </>
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
