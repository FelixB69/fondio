"use client";

import { useMemo, useState } from "react";
import { AGENTS, AgentId, Task } from "@/lib/data";
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

export function TasksScreen({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const isMobile = useIsMobile();
  const [newTaskText, setNewTaskText] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const {
    tasks,
    loading,
    addTask: createTask,
    cycleStatus,
    setPriority,
    setDueDate,
    setStartDate,
    setContent,
    removeTask,
  } = useTasks();

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) {
      if (matchesFilter(t, filter)) g[t.status].push(t);
    }
    for (const status of STATUS_ORDER) g[status].sort(compareTasks);
    return g;
  }, [tasks, filter]);

  // Compteurs des chips — sur l'ensemble complet, indépendamment du filtre actif.
  const counts = useMemo(() => filterCounts(tasks), [tasks]);

  // Progression sur TOUTES les tâches (pas le sous-ensemble filtré), pour rester
  // stable quel que soit le filtre actif.
  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);
  const progress = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((doneCount / tasks.length) * 100);
  }, [tasks, doneCount]);

  const addTask = async () => {
    const text = newTaskText.trim();
    if (!text) return;
    const created = await createTask({ content: text });
    if (created) setNewTaskText("");
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Icon name="tasks" size={20} color={C.navy} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Tâches
          </h1>
          {tasks.length > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                color: C.textSub,
                background: C.bg,
                padding: "3px 9px",
                borderRadius: 100,
                fontWeight: 600,
              }}
            >
              {doneCount} / {tasks.length} · {progress}%
            </span>
          )}
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: C.textSub }}>
          Ajoutez des tâches ou convertissez-en directement depuis les livrables d'un agent (bouton ⊕ dans le chat).
        </p>

        {/* Progress bar */}
        {tasks.length > 0 && (
          <div
            style={{
              height: 5,
              background: C.bg,
              borderRadius: 100,
              overflow: "hidden",
              marginBottom: 14,
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

        {/* Quick add */}
        <div
          style={{
            display: "flex",
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
            placeholder="Nouvelle action : Appeler…, Rédiger…, Tester…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 13.5,
              color: C.text,
              fontFamily: "inherit",
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

        {/* Barre de filtres */}
        {tasks.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <FilterChips filters={FILTERS} active={filter} counts={counts} onChange={setFilter} />
          </div>
        )}
      </div>

      {/* Body — 3 colonnes kanban */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {loading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && tasks.length === 0 && (
          <div
            style={{
              marginTop: 60,
              textAlign: "center",
              color: C.textMute,
              fontSize: 14,
              maxWidth: 380,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.6,
            }}
          >
            Pas encore de tâche. Ajoutez la première ci-dessus, ou convertissez un livrable depuis le chat.
          </div>
        )}

        {!loading && tasks.length > 0 && (
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
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: meta.color,
                        }}
                      />
                      {meta.label}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: C.textMute,
                        fontWeight: 700,
                      }}
                    >
                      {items.length}
                    </span>
                  </div>
                  {items.length === 0 && (
                    <div style={{ fontSize: 12, color: C.textMute, padding: "10px 4px" }}>
                      Vide.
                    </div>
                  )}
                  {items.map((task) => {
                    const agent = task.source_agent_id ? AGENTS[task.source_agent_id as AgentId] : null;
                    const prio = PRIORITY_META[task.priority];
                    const due = task.due_date ? dueDateMeta(task.due_date, status === "done") : null;
                    return (
                      <div
                        key={task.id}
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
                        <EditableContent task={task} done={status === "done"} fontSize={13} onSave={(c) => setContent(task, c)} />
                        {(prio || due || agent) && (
                          // Badges (priorité / échéance) + lien vers la conversation source,
                          // tout sur une même ligne ; wrappe proprement si trop étroit.
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {prio && <Badge label={prio.label} color={prio.color} bg={prio.bg} icon={task.priority === "high" ? "warning" : undefined} />}
                            {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
                            {agent && (
                              <span
                                style={{
                                  fontSize: 10.5,
                                  color: agent.color,
                                  fontWeight: 600,
                                  display: "inline-flex",
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
                              </span>
                            )}
                          </div>
                        )}
                        <TaskControls task={task} onSetPriority={(p) => setPriority(task, p)} onSetStart={(d) => setStartDate(task, d)} onSetDue={(d) => setDueDate(task, d)} />
                        <div style={{ display: "flex", gap: 5 }}>
                          <button
                            onClick={() => cycleStatus(task)}
                            title={`Passer à : ${STATUS_META[NEXT_STATUS[task.status]].label}`}
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
                                {STATUS_META[NEXT_STATUS[task.status]].label}
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => removeTask(task)}
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
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
