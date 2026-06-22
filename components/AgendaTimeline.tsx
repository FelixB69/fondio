"use client";

// Vue Timeline / Gantt de l'agenda. Place chaque tâche datée en barre
// horizontale (start_date → due_date) sur un axe de jours navigable, groupée
// par projet. Glisser une barre la replanifie ; cliquer un jour de la ligne
// « + » crée une tâche datée. Les tâches sans date vivent dans une section à
// part d'où on peut leur attribuer une échéance.
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AGENTS, AgentId, Task } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import {
  addDaysYmd,
  diffDaysYmd,
  dueDateMeta,
  eachDayYmd,
  parseYmd,
  PRIORITY_META,
  startOfWeekYmd,
  taskBounds,
  todayStr,
} from "@/lib/tasks";
import { Icon, IconName } from "./Icon";
import { Badge, EditableContent, TaskControls } from "./TaskBits";

export interface ProjectLite {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

const LABEL_W = 200;
const DAY_W = 32;
const ROW_H = 36;
const BAR_H = 22;
const WEEKS = 6;
const NODATE_KEY = "__nodate__";

interface AgendaTimelineProps {
  tasks: Task[]; // déjà filtrées par le parent
  projects: Record<string, ProjectLite>;
  onShiftDates: (task: Task, deltaDays: number) => void;
  onSetStart: (task: Task, start: string | null) => void;
  onSetDue: (task: Task, due: string | null) => void;
  onSetContent: (task: Task, content: string) => void;
  onComplete: (task: Task) => void;
  onAddTask: (input: { content: string; due_date: string; project_id: string | null }) => void;
  onOpenSession: (id: string) => void;
  onOpenTask: (task: Task) => void; // clic (sans glisser) sur une barre → popup d'édition
}

type DragMode = "move" | "start" | "end";
interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  deltaDays: number;
  moved: boolean;
}

interface Group {
  key: string; // project id, ou NODATE_KEY pour « Sans projet »
  project: ProjectLite | null;
  tasks: Task[];
}

export function AgendaTimeline({
  tasks,
  projects,
  onShiftDates,
  onSetStart,
  onSetDue,
  onSetContent,
  onComplete,
  onAddTask,
  onOpenSession,
  onOpenTask,
}: AgendaTimelineProps) {
  const today = todayStr();
  // Fenêtre de 6 semaines, démarrant une semaine avant la semaine courante pour
  // garder les retards récents visibles. Décalable par pas d'une semaine.
  const [windowStart, setWindowStart] = useState(() => addDaysYmd(startOfWeekYmd(today), -7));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [add, setAdd] = useState<{ key: string; date: string; text: string } | null>(null);

  const days = useMemo(() => {
    const end = addDaysYmd(windowStart, WEEKS * 7 - 1);
    return eachDayYmd(windowStart, end);
  }, [windowStart]);
  const windowEnd = days[days.length - 1];
  const gridW = days.length * DAY_W;
  const todayIdx = diffDaysYmd(windowStart, today);

  // Sépare les tâches datées (placées sur l'axe) des non datées (section à part).
  const { groups, undated } = useMemo(() => {
    const dated: Task[] = [];
    const undated: Task[] = [];
    for (const t of tasks) (taskBounds(t) ? dated : undated).push(t);

    const byKey = new Map<string, Task[]>();
    for (const t of dated) {
      const key = t.project_id ?? NODATE_KEY;
      const arr = byKey.get(key) ?? [];
      arr.push(t);
      byKey.set(key, arr);
    }

    const groups: Group[] = [];
    for (const [key, arr] of byKey) {
      // On ne garde que les tâches qui croisent la fenêtre visible.
      const visible = arr.filter((t) => {
        const b = taskBounds(t)!;
        return b.start <= windowEnd && b.end >= windowStart;
      });
      if (visible.length === 0) continue;
      visible.sort((a, b) => {
        const ba = taskBounds(a)!.start;
        const bb = taskBounds(b)!.start;
        return ba < bb ? -1 : ba > bb ? 1 : 0;
      });
      groups.push({ key, project: key === NODATE_KEY ? null : projects[key] ?? null, tasks: visible });
    }
    // Projets nommés triés alpha, « Sans projet » en dernier.
    groups.sort((a, b) => {
      if (a.key === NODATE_KEY) return 1;
      if (b.key === NODATE_KEY) return -1;
      return (a.project?.name ?? "").localeCompare(b.project?.name ?? "");
    });
    return { groups, undated };
  }, [tasks, projects, windowStart, windowEnd]);

  // ---- Drag (pointer events avec capture) --------------------------------
  const onBarDown = (e: ReactPointerEvent, task: Task, mode: DragMode) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ taskId: task.id, mode, startX: e.clientX, deltaDays: 0, moved: false });
  };
  const onBarMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const deltaDays = Math.round(dx / DAY_W);
    if (deltaDays !== drag.deltaDays || (!drag.moved && Math.abs(dx) > 3)) {
      setDrag({ ...drag, deltaDays, moved: drag.moved || Math.abs(dx) > 3 });
    }
  };
  const onBarUp = (task: Task) => {
    if (!drag) return;
    const { mode, deltaDays, moved } = drag;
    setDrag(null);
    // Pression sans glisser = clic → on ouvre la popup d'édition.
    if (!moved) {
      onOpenTask(task);
      return;
    }
    if (deltaDays === 0) return;
    const b = taskBounds(task)!;
    if (mode === "move") {
      onShiftDates(task, deltaDays);
    } else if (mode === "start" && task.start_date) {
      // On ne laisse pas le début dépasser la fin.
      const next = addDaysYmd(task.start_date, deltaDays);
      onSetStart(task, next > b.end ? b.end : next);
    } else if (mode === "end" && task.due_date) {
      const next = addDaysYmd(task.due_date, deltaDays);
      onSetDue(task, b.start > next ? b.start : next);
    }
  };

  // Géométrie d'une barre dans la fenêtre, avec aperçu du drag en cours.
  const barGeometry = (task: Task) => {
    const b = taskBounds(task)!;
    let startIdx = diffDaysYmd(windowStart, b.start);
    let endIdx = diffDaysYmd(windowStart, b.end);
    if (drag && drag.taskId === task.id) {
      if (drag.mode === "move") {
        startIdx += drag.deltaDays;
        endIdx += drag.deltaDays;
      } else if (drag.mode === "start") {
        startIdx = Math.min(startIdx + drag.deltaDays, endIdx);
      } else if (drag.mode === "end") {
        endIdx = Math.max(endIdx + drag.deltaDays, startIdx);
      }
    }
    const left = startIdx * DAY_W;
    const width = (endIdx - startIdx + 1) * DAY_W;
    return { left, width, clippedLeft: startIdx < 0, clippedRight: endIdx > days.length - 1 };
  };

  const goToday = () => setWindowStart(addDaysYmd(startOfWeekYmd(today), -7));
  const rangeLabel = useMemo(() => {
    const s = parseYmd(windowStart);
    const e = parseYmd(windowEnd);
    const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return `${fmt(s)} – ${fmt(e)}`;
  }, [windowStart, windowEnd]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Barre de navigation temporelle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <NavBtn label="‹" onClick={() => setWindowStart((s) => addDaysYmd(s, -7))} />
        <button
          onClick={goToday}
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 700,
            color: C.navy,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Aujourd'hui
        </button>
        <NavBtn label="›" onClick={() => setWindowStart((s) => addDaysYmd(s, 7))} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textSub, marginLeft: 4 }}>{rangeLabel}</span>
      </div>

      {/* Grille scrollable horizontalement */}
      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          background: C.white,
        }}
      >
        <div style={{ width: LABEL_W + gridW, position: "relative" }}>
          {/* En-tête axe des jours */}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 3 }}>
            <div
              style={{
                width: LABEL_W,
                flexShrink: 0,
                position: "sticky",
                left: 0,
                zIndex: 4,
                background: C.white,
                borderRight: `1px solid ${C.border}`,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 800,
                color: C.textMute,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                display: "flex",
                alignItems: "center",
              }}
            >
              Tâche
            </div>
            <div style={{ display: "flex", background: C.white }}>
              {days.map((d, i) => {
                const dt = parseYmd(d);
                const dow = dt.getDay(); // 0 dim … 6 sam
                const weekend = dow === 0 || dow === 6;
                const isToday = i === todayIdx;
                const isMonthStart = d.endsWith("-01") || i === 0;
                return (
                  <div
                    key={d}
                    style={{
                      width: DAY_W,
                      flexShrink: 0,
                      textAlign: "center",
                      padding: "4px 0 5px",
                      borderLeft: isMonthStart ? `1px solid ${C.navyMid}` : `1px solid ${C.border}`,
                      background: isToday ? C.navyLight : weekend ? C.bg : C.white,
                    }}
                  >
                    <div style={{ fontSize: 9, color: weekend ? C.textMute : C.textSub, fontWeight: 700 }}>
                      {dt.toLocaleDateString("fr-FR", { weekday: "narrow" })}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: isToday ? 800 : 600, color: isToday ? C.navy : C.text }}>
                      {dt.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Corps : couche de fond (week-ends + ligne du jour) + lignes */}
          <div style={{ position: "relative" }}>
            {/* Couche de fond derrière les barres */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {days.map((d, i) => {
                const dow = parseYmd(d).getDay();
                const weekend = dow === 0 || dow === 6;
                if (!weekend) return null;
                return (
                  <div
                    key={d}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: LABEL_W + i * DAY_W,
                      width: DAY_W,
                      background: C.bg,
                      opacity: 0.6,
                    }}
                  />
                );
              })}
              {todayIdx >= 0 && todayIdx < days.length && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: LABEL_W + todayIdx * DAY_W,
                    width: DAY_W,
                    background: C.navyLight,
                    opacity: 0.7,
                    borderLeft: `2px solid ${C.navy}`,
                  }}
                />
              )}
            </div>

            {groups.length === 0 && (
              <div style={{ padding: "28px 16px", textAlign: "center", color: C.textMute, fontSize: 13, position: "relative" }}>
                Aucune tâche datée sur cette période.
              </div>
            )}

            {groups.map((g) => (
              <div key={g.key} style={{ position: "relative" }}>
                {/* En-tête de groupe projet */}
                <GroupHeader group={g} />

                {/* Lignes de tâches */}
                {g.tasks.map((task) => {
                  const geo = barGeometry(task);
                  const color = barColor(task, g.project, today);
                  const dragging = drag?.taskId === task.id;
                  const agent = task.source_agent_id ? AGENTS[task.source_agent_id as AgentId] : null;
                  return (
                    <div key={task.id} style={{ display: "flex", height: ROW_H, position: "relative" }}>
                      {/* Libellé (sticky) */}
                      <div
                        style={{
                          width: LABEL_W,
                          flexShrink: 0,
                          position: "sticky",
                          left: 0,
                          zIndex: 2,
                          background: C.white,
                          borderRight: `1px solid ${C.border}`,
                          borderBottom: `1px solid ${C.border}`,
                          padding: "0 8px 0 10px",
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                        }}
                      >
                        <CompleteBtn onClick={() => onComplete(task)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <EditableContent task={task} done={task.status === "done"} fontSize={12.5} singleLine onSave={(c) => onSetContent(task, c)} />
                        </div>
                        {agent && task.session_id && (
                          <button
                            onClick={() => onOpenSession(task.session_id!)}
                            title={`Ouvrir la session · ${agent.name}`}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexShrink: 0 }}
                          >
                            <Icon name={agent.icon as IconName} size={12} color={agent.color} />
                          </button>
                        )}
                      </div>

                      {/* Piste + barre */}
                      <div style={{ position: "relative", width: gridW, borderBottom: `1px solid ${C.border}` }}>
                        <div
                          onPointerDown={(e) => onBarDown(e, task, "move")}
                          onPointerMove={onBarMove}
                          onPointerUp={() => onBarUp(task)}
                          title={`${task.content}\n${taskBounds(task)!.start} → ${taskBounds(task)!.end}\nCliquer pour modifier · glisser pour déplacer`}
                          style={{
                            position: "absolute",
                            top: (ROW_H - BAR_H) / 2,
                            left: geo.left,
                            width: Math.max(geo.width, DAY_W - 4),
                            height: BAR_H,
                            background: task.status === "done" ? C.bg : `${color}1F`,
                            border: `1.5px solid ${color}`,
                            borderTopLeftRadius: geo.clippedLeft ? 0 : 7,
                            borderBottomLeftRadius: geo.clippedLeft ? 0 : 7,
                            borderTopRightRadius: geo.clippedRight ? 0 : 7,
                            borderBottomRightRadius: geo.clippedRight ? 0 : 7,
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            cursor: dragging && drag?.mode === "move" ? "grabbing" : "grab",
                            touchAction: "none",
                            boxShadow: dragging ? C.shadowMd : "none",
                            opacity: task.status === "done" ? 0.7 : 1,
                            userSelect: "none",
                          }}
                        >
                          {/* Poignée début */}
                          {task.start_date && (
                            <Handle onPointerDown={(e) => onBarDown(e, task, "start")} onPointerMove={onBarMove} onPointerUp={() => onBarUp(task)} side="left" color={color} />
                          )}
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: task.status === "done" ? C.textMute : color,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              textDecoration: task.status === "done" ? "line-through" : "none",
                              pointerEvents: "none",
                            }}
                          >
                            {task.priority === "high" && <Icon name="warning" size={9} color={color} />} {task.content}
                          </span>
                          {/* Poignée fin */}
                          {task.due_date && (
                            <Handle onPointerDown={(e) => onBarDown(e, task, "end")} onPointerMove={onBarMove} onPointerUp={() => onBarUp(task)} side="right" color={color} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Ligne d'ajout daté */}
                <AddRow
                  projectId={g.key === NODATE_KEY ? null : g.key}
                  groupKey={g.key}
                  gridW={gridW}
                  windowStart={windowStart}
                  add={add}
                  setAdd={setAdd}
                  onAddTask={onAddTask}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section « Sans échéance » */}
      {undated.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 8,
              fontSize: 12,
              fontWeight: 800,
              color: C.textMute,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            <Icon name="tasks" size={13} color={C.textMute} />
            Sans échéance
            <span style={{ fontWeight: 700 }}>· {undated.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {undated.map((task) => {
              const proj = task.project_id ? projects[task.project_id] : undefined;
              const projColor = proj?.color ?? C.navy;
              return (
                <div
                  key={task.id}
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
                  <CompleteBtn onClick={() => onComplete(task)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <EditableContent task={task} done={task.status === "done"} fontSize={13.5} onSave={(c) => onSetContent(task, c)} />
                    {proj && (
                      <div style={{ marginTop: 5 }}>
                        <Badge label={proj.name} color={projColor} bg={`${projColor}14`} icon={(proj.icon ?? "target") as IconName} />
                      </div>
                    )}
                  </div>
                  <TaskControls task={task} onSetPriority={() => {}} onSetStart={(d) => onSetStart(task, d)} onSetDue={(d) => onSetDue(task, d)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Sous-composants
// --------------------------------------------------------------------------

function NavBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        background: C.white,
        border: `1.5px solid ${C.border}`,
        color: C.navy,
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 1,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label}
    </button>
  );
}

function CompleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
      }}
    >
      <Icon name="check" size={11} color={C.mint} />
    </button>
  );
}

function Handle({
  side,
  color,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  side: "left" | "right";
  color: string;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side]: 0,
        width: 8,
        cursor: "ew-resize",
        touchAction: "none",
        borderLeft: side === "right" ? `2px solid ${color}` : undefined,
        borderRight: side === "left" ? `2px solid ${color}` : undefined,
        opacity: 0.5,
      }}
    />
  );
}

function GroupHeader({ group }: { group: Group }) {
  const color = group.project?.color ?? C.textSub;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        position: "sticky",
        left: 0,
        zIndex: 2,
        width: LABEL_W,
        background: C.white,
        padding: "8px 12px 6px",
        borderRight: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <Icon name={(group.project?.icon ?? "tasks") as IconName} size={13} color={color} />
      <span style={{ fontSize: 12, fontWeight: 800, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {group.project?.name ?? "Sans projet"}
      </span>
      <span style={{ fontSize: 11, color: C.textMute, fontWeight: 700 }}>· {group.tasks.length}</span>
    </div>
  );
}

function AddRow({
  projectId,
  groupKey,
  gridW,
  windowStart,
  add,
  setAdd,
  onAddTask,
}: {
  projectId: string | null;
  groupKey: string;
  gridW: number;
  windowStart: string;
  add: { key: string; date: string; text: string } | null;
  setAdd: (a: { key: string; date: string; text: string } | null) => void;
  onAddTask: (input: { content: string; due_date: string; project_id: string | null }) => void;
}) {
  const active = add?.key === groupKey;
  const submit = () => {
    if (active && add.text.trim()) {
      onAddTask({ content: add.text.trim(), due_date: add.date, project_id: projectId });
    }
    setAdd(null);
  };
  return (
    <div style={{ display: "flex", height: 28, position: "relative" }}>
      <div
        style={{
          width: LABEL_W,
          flexShrink: 0,
          position: "sticky",
          left: 0,
          zIndex: 2,
          background: C.white,
          borderRight: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          fontSize: 11,
          color: C.textMute,
          fontWeight: 600,
        }}
      >
        <Icon name="plus" size={10} color={C.textMute} />
        <span style={{ marginLeft: 5 }}>cliquer un jour</span>
      </div>
      <div
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const idx = Math.floor((e.clientX - rect.left) / DAY_W);
          setAdd({ key: groupKey, date: addDaysYmd(windowStart, idx), text: "" });
        }}
        style={{ position: "relative", width: gridW, borderBottom: `1px solid ${C.border}`, cursor: "copy" }}
      >
        {active && (
          <div
            style={{
              position: "absolute",
              top: 2,
              left: diffDaysYmd(windowStart, add.date) * DAY_W,
              display: "flex",
              gap: 4,
              alignItems: "center",
              zIndex: 5,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={add.text}
              onChange={(e) => setAdd({ ...add, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                else if (e.key === "Escape") setAdd(null);
              }}
              onBlur={submit}
              placeholder={`Tâche · ${parseYmd(add.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`}
              style={{
                width: 200,
                height: 24,
                border: `1.5px solid ${C.navyMid}`,
                borderRadius: 6,
                padding: "0 8px",
                fontSize: 12,
                fontFamily: "inherit",
                color: C.text,
                outline: "none",
                background: C.white,
                boxShadow: C.shadow,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Couleur d'une barre : retard → rouge, sinon couleur projet (navy par défaut).
function barColor(task: Task, project: ProjectLite | null, today: string): string {
  if (task.status !== "done" && task.due_date && task.due_date < today) {
    return dueDateMeta(task.due_date, false).color; // rouge des retards
  }
  if (task.priority === "high") return PRIORITY_META.high!.color;
  return project?.color ?? C.navy;
}
