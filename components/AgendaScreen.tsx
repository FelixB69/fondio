"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, Task, TaskPriority } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { agendaBucket, AgendaBucket, AGENDA_BUCKETS, compareTasks, dueDateMeta, PRIORITY_META } from "@/lib/tasks";
import { Icon, IconName } from "./Icon";
import { Badge, EditableContent, TaskControls } from "./TaskBits";

// Infos projet minimales affichées sur chaque tâche de l'agenda.
interface ProjectLite {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export function AgendaScreen({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectLite>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // On ne charge que les tâches non terminées : l'agenda regarde devant soi.
    const [tasksRes, projRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, session_id, project_id, content, status, priority, start_date, due_date, source_agent_id, created_at, completed_at")
        .neq("status", "done")
        .order("due_date", { ascending: true }),
      supabase.from("projects").select("id, name, icon, color"),
    ]);
    setTasks((tasksRes.data ?? []) as Task[]);
    const map: Record<string, ProjectLite> = {};
    for (const p of (projRes.data ?? []) as ProjectLite[]) map[p.id] = p;
    setProjects(map);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Regroupement par horizon temporel, chaque bucket trié comme les autres écrans.
  const buckets = useMemo(() => {
    const b: Record<AgendaBucket, Task[]> = { overdue: [], today: [], week: [], later: [], nodate: [] };
    for (const t of tasks) {
      const id = agendaBucket(t);
      if (id) b[id].push(t);
    }
    for (const id of Object.keys(b) as AgendaBucket[]) b[id].sort(compareTasks);
    return b;
  }, [tasks]);

  const total = tasks.length;
  const overdueCount = buckets.overdue.length;
  const todayCount = buckets.today.length;

  // Marquer fait : la tâche quitte l'agenda (agendaBucket renvoie null pour done).
  const complete = async (task: Task) => {
    const completed_at = new Date().toISOString();
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, status: "done", completed_at } : t)));
    await supabase.from("tasks").update({ status: "done", completed_at }).eq("id", task.id);
  };

  const setPriority = async (task: Task, priority: TaskPriority) => {
    if (task.priority === priority) return;
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, priority } : t)));
    await supabase.from("tasks").update({ priority }).eq("id", task.id);
  };

  const setDueDate = async (task: Task, due_date: string | null) => {
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, due_date } : t)));
    await supabase.from("tasks").update({ due_date }).eq("id", task.id);
  };

  const setStartDate = async (task: Task, start_date: string | null) => {
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, start_date } : t)));
    await supabase.from("tasks").update({ start_date }).eq("id", task.id);
  };

  const setContent = async (task: Task, content: string) => {
    if (content === task.content) return;
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, content } : t)));
    await supabase.from("tasks").update({ content }).eq("id", task.id);
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
          <Icon name="clock" size={20} color={C.navy} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Agenda
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: C.textSub }}>
          {overdueCount > 0 ? (
            <>
              <span style={{ color: "#DC2626", fontWeight: 700 }}>{overdueCount} en retard</span>
              {" · "}
            </>
          ) : null}
          {todayCount > 0 ? <span style={{ fontWeight: 600 }}>{todayCount} aujourd'hui</span> : "Vos tâches à venir, tous projets confondus."}
        </p>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {loading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && total === 0 && (
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
            Rien à l'agenda. Toutes vos tâches sont terminées ou vous n'en avez pas encore.
          </div>
        )}

        {!loading && total > 0 && (
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
    </div>
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
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
      }}
    >
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
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: `${projColor}14`,
                color: projColor,
                border: `1px solid ${projColor}28`,
                borderRadius: 5,
                padding: "2px 6px",
                fontSize: 10,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              <Icon name={(project.icon ?? "target") as IconName} size={9} color={projColor} />
              {project.name}
            </span>
          )}
          {prio && <Badge label={prio.label} color={prio.color} bg={prio.bg} icon={task.priority === "high" ? "warning" : undefined} />}
          {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
          {agent && task.session_id && (
            <button
              onClick={() => onOpenSession(task.session_id!)}
              title={`Ouvrir la session · ${agent.name}`}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: agent.color,
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "inherit",
              }}
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
