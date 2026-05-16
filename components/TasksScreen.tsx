"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, Task, TaskStatus } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  todo: { label: "À faire", color: C.navy, bg: C.navyLight },
  doing: { label: "En cours", color: "#D97706", bg: "#FFFBEB" },
  done: { label: "Fait", color: "#0E9F88", bg: "#EDFAF7" },
};

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

export function TasksScreen({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("id, session_id, project_id, content, status, source_agent_id, created_at, completed_at")
      .order("created_at", { ascending: false });
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) g[t.status].push(t);
    return g;
  }, [tasks]);

  const progress = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((grouped.done.length / tasks.length) * 100);
  }, [tasks, grouped.done]);

  const addTask = async () => {
    const text = newTaskText.trim();
    if (!text) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: user.id, content: text, status: "todo" })
      .select("id, session_id, content, status, source_agent_id, created_at, completed_at")
      .single();
    if (error || !data) return;
    setTasks((p) => [data as Task, ...p]);
    setNewTaskText("");
  };

  const cycleStatus = async (task: Task) => {
    const next = NEXT_STATUS[task.status];
    const completed_at = next === "done" ? new Date().toISOString() : null;
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, status: next, completed_at } : t)));
    await supabase.from("tasks").update({ status: next, completed_at }).eq("id", task.id);
  };

  const removeTask = async (task: Task) => {
    setTasks((p) => p.filter((t) => t.id !== task.id));
    await supabase.from("tasks").delete().eq("id", task.id);
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
              {grouped.done.length} / {tasks.length} · {progress}%
            </span>
          )}
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: C.textSub }}>
          Ajoute des tâches ou convertis-en directement depuis les livrables d'un agent (bouton ⊕ dans le chat).
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
            placeholder="Nouvelle tâche…"
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
            Pas encore de tâche. Ajoute la première ci-dessus, ou convertis un livrable depuis le chat.
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
            {(Object.keys(STATUS_META) as TaskStatus[]).map((status) => {
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
                        <div
                          style={{
                            fontSize: 13,
                            color: C.text,
                            lineHeight: 1.45,
                            textDecoration: status === "done" ? "line-through" : "none",
                            opacity: status === "done" ? 0.7 : 1,
                          }}
                        >
                          {task.content}
                        </div>
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
