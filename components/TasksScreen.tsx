"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, Task, TaskPriority, TaskStatus } from "@/lib/data";
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

// Métadonnées d'affichage par priorité. `normal` = null → aucun badge (réduit le bruit).
const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string } | null> = {
  low: { label: "Basse", color: C.textMute, bg: C.bg },
  normal: null,
  high: { label: "Haute", color: "#DC2626", bg: "#FEF2F2" },
};

// Rang de tri : plus petit = plus haut dans la liste.
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "done"];

// Ordre de tri d'une colonne : échéance (datées avant non datées, plus proche
// d'abord → retards en haut) → priorité → création la plus récente.
// due_date est une chaîne "YYYY-MM-DD" : la comparaison alphabétique suffit.
function compareTasks(a: Task, b: Task): number {
  if (a.due_date && b.due_date) {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  } else if (a.due_date) {
    return -1;
  } else if (b.due_date) {
    return 1;
  }
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }
  return a.created_at < b.created_at ? 1 : -1;
}

type TaskFilter = "all" | "overdue" | "week" | "high";

const FILTERS: Array<{ id: TaskFilter; label: string; icon?: IconName }> = [
  { id: "all", label: "Toutes" },
  { id: "overdue", label: "En retard", icon: "warning" },
  { id: "week", label: "Cette semaine", icon: "clock" },
  { id: "high", label: "Priorité haute" },
];

// Aujourd'hui au format "YYYY-MM-DD" en heure LOCALE (pas UTC) — sert à comparer
// avec due_date qui est aussi une chaîne "YYYY-MM-DD". Comparaison de chaînes = ok.
function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Date locale dans N jours, au format "YYYY-MM-DD".
function inDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Prédicat d'un filtre. Les filtres temporels ignorent les tâches `done`
// (une tâche faite n'est plus "en retard" ni "à venir").
function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "high") return task.priority === "high";
  if (task.status === "done" || !task.due_date) return false;
  if (filter === "overdue") return task.due_date < todayStr();
  if (filter === "week") return task.due_date >= todayStr() && task.due_date <= inDaysStr(7);
  return true;
}

export function TasksScreen({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("id, session_id, project_id, content, status, priority, due_date, source_agent_id, created_at, completed_at")
      .order("created_at", { ascending: false });
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) {
      if (matchesFilter(t, filter)) g[t.status].push(t);
    }
    for (const status of STATUS_ORDER) g[status].sort(compareTasks);
    return g;
  }, [tasks, filter]);

  // Compteurs pour les pastilles des chips — calculés sur TOUTES les tâches,
  // indépendamment du filtre actif.
  const counts = useMemo(() => {
    const c: Record<TaskFilter, number> = { all: tasks.length, overdue: 0, week: 0, high: 0 };
    for (const t of tasks) {
      if (matchesFilter(t, "overdue")) c.overdue++;
      if (matchesFilter(t, "week")) c.week++;
      if (matchesFilter(t, "high")) c.high++;
    }
    return c;
  }, [tasks]);

  // Progression calculée sur TOUTES les tâches (pas le sous-ensemble filtré),
  // pour rester stable quel que soit le filtre actif.
  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);
  const progress = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((doneCount / tasks.length) * 100);
  }, [tasks, doneCount]);

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
      .select("id, session_id, project_id, content, status, priority, due_date, source_agent_id, created_at, completed_at")
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

  const setPriority = async (task: Task, priority: TaskPriority) => {
    if (task.priority === priority) return;
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, priority } : t)));
    await supabase.from("tasks").update({ priority }).eq("id", task.id);
  };

  // due_date null = on enlève l'échéance. L'input HTML renvoie "" → on le convertit en null.
  const setDueDate = async (task: Task, due_date: string | null) => {
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, due_date } : t)));
    await supabase.from("tasks").update({ due_date }).eq("id", task.id);
  };

  const setContent = async (task: Task, content: string) => {
    if (content === task.content) return;
    setTasks((p) => p.map((t) => (t.id === task.id ? { ...t, content } : t)));
    await supabase.from("tasks").update({ content }).eq("id", task.id);
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
              {doneCount} / {tasks.length} · {progress}%
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

        {/* Barre de filtres */}
        {tasks.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {FILTERS.map((f) => {
              const active = filter === f.id;
              const count = counts[f.id];
              // On masque les chips temporels/priorité vides (sauf "Toutes").
              if (f.id !== "all" && count === 0) return null;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
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
                  {f.icon && <Icon name={f.icon} size={11} color={active ? "white" : C.textSub} />}
                  {f.label}
                  <span style={{ opacity: active ? 0.85 : 0.6, fontWeight: 600 }}>{count}</span>
                </button>
              );
            })}
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
                        <TaskControls task={task} onSetPriority={(p) => setPriority(task, p)} onSetDue={(d) => setDueDate(task, d)} />
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

// Contrôles d'édition partagés (priorité + échéance).
function TaskControls({
  task,
  onSetPriority,
  onSetDue,
}: {
  task: Task;
  onSetPriority: (p: TaskPriority) => void;
  onSetDue: (d: string | null) => void;
}) {
  const ctrlStyle = {
    background: C.white,
    color: C.textSub,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
  } as const;
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
      <select
        value={task.priority}
        onChange={(e) => onSetPriority(e.target.value as TaskPriority)}
        title="Priorité"
        style={ctrlStyle}
      >
        <option value="low">Basse</option>
        <option value="normal">Normale</option>
        <option value="high">Haute</option>
      </select>
      {/* value="" quand pas d'échéance ; l'input renvoie "" si vidé → on remet null. */}
      <input
        type="date"
        value={task.due_date ?? ""}
        onChange={(e) => onSetDue(e.target.value || null)}
        title="Échéance"
        style={{ ...ctrlStyle, color: task.due_date ? C.text : C.textMute }}
      />
    </div>
  );
}

// Contenu de tâche éditable au clic. État local (editing + draft) : tant qu'on
// n'édite pas, on affiche un div ; au clic on bascule en textarea. On sauvegarde
// sur Entrée ou perte de focus, on annule sur Échap. Le parent n'est notifié
// (onSave) que si le texte a réellement changé et n'est pas vide.
function EditableContent({
  task,
  done,
  fontSize,
  onSave,
}: {
  task: Task;
  done: boolean;
  fontSize: number;
  onSave: (content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.content);

  const startEdit = () => {
    setDraft(task.content);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== task.content) onSave(text);
    else setDraft(task.content);
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(task.content);
            setEditing(false);
          }
        }}
        rows={2}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontSize,
          color: C.text,
          lineHeight: 1.45,
          fontFamily: "inherit",
          border: `1px solid ${C.navyMid}`,
          borderRadius: 6,
          padding: "5px 7px",
          outline: "none",
          resize: "vertical",
          background: C.white,
        }}
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      title="Cliquer pour modifier"
      style={{
        fontSize,
        color: C.text,
        lineHeight: 1.45,
        textDecoration: done ? "line-through" : "none",
        opacity: done ? 0.7 : 1,
        cursor: "text",
        whiteSpace: "pre-wrap",
      }}
    >
      {task.content}
    </div>
  );
}

// Petit badge générique réutilisé pour priorité + échéance.
function Badge({ label, color, bg, icon }: { label: string; color: string; bg: string; icon?: IconName }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        background: bg,
        color,
        border: `1px solid ${color}28`,
        borderRadius: 5,
        padding: "2px 6px",
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {icon && <Icon name={icon} size={9} color={color} />}
      {label}
    </span>
  );
}

// Transforme une échéance "YYYY-MM-DD" en label + couleur selon l'urgence.
// On parse en date LOCALE (pas UTC) pour éviter les décalages de fuseau, et on
// compare au jour d'aujourd'hui à minuit. Une tâche `done` n'est jamais "en retard".
function dueDateMeta(dueDate: string, done: boolean): { label: string; color: string; bg: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);

  const short = due.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  // Une tâche faite n'est jamais "en retard" : on affiche juste la date, en gris.
  if (done) return { label: short, color: C.textMute, bg: C.bg };

  let label: string;
  if (diff === 0) label = "Aujourd'hui";
  else if (diff === 1) label = "Demain";
  else if (diff === -1) label = "Hier";
  else if (diff < 0) label = `Retard · ${short}`;
  else label = short;

  if (diff < 0) return { label, color: "#DC2626", bg: "#FEF2F2" };
  if (diff <= 1) return { label, color: "#D97706", bg: "#FFFBEB" };
  return { label, color: C.textSub, bg: C.bg };
}
