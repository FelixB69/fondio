"use client";

// Onglet « Vue d'ensemble » : le cockpit de pilotage du projet.
//
// Il répond à « où j'en suis, qu'est-ce qui coince, quoi faire ensuite » — pas à
// « qu'est-ce que je fais maintenant », qui est le rôle du board de tâches.
//
// Tout l'affichage dérive de `buildDashboard()` : ce composant ne calcule rien,
// il rend. Les actions remontent sous forme d'INTENTIONS (`DashboardAction`) que
// le parent traduit en navigation — ce composant ignore le routeur.
import { useMemo, useState } from "react";
import { AGENTS, Task } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { formatRelative } from "@/lib/format";
import { buildDashboard, DashboardAction, DashboardAlert } from "@/lib/project-dashboard";
import {
  Project,
  ProjectSessionRow,
  STAGES,
  StageId,
  nextStage,
  stageIndex,
  stageMeta,
} from "@/lib/projects";
import { dueDateMeta, PRIORITY_META, STATUS_META } from "@/lib/tasks";
import { useIsMobile } from "@/lib/use-responsive";
import { useTasks } from "@/lib/use-tasks";
import { Icon, IconName } from "./Icon";
import { Badge } from "./TaskBits";
import { TaskDetailModal } from "./TaskDetailModal";

// Nombre de termes de glossaire visibles avant dépliage.
const GLOSSARY_PREVIEW = 6;

const ALERT_COLORS: Record<DashboardAlert["level"], string> = {
  warn: "#D97706",
  info: C.navy,
};

export function ProjectOverviewTab({
  project,
  sessions,
  onOpenSession,
  onAction,
  onStageChange,
}: {
  project: Project;
  sessions: ProjectSessionRow[];
  onOpenSession: (sessionId: string) => void;
  onAction: (action: DashboardAction) => void;
  onStageChange: (stage: StageId) => void;
}) {
  const isMobile = useIsMobile();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [glossaryExpanded, setGlossaryExpanded] = useState(false);

  const t = useTasks({ projectId: project.id });
  const { tasks } = t;

  const dash = useMemo(
    () => buildDashboard({ project, tasks, sessions }),
    [project, tasks, sessions],
  );

  const glossary = project.glossary ?? [];
  // Les plus récents d'abord : le glossaire s'empile par ordre d'explication.
  const shownGlossary = glossaryExpanded
    ? [...glossary].reverse()
    : [...glossary].reverse().slice(0, GLOSSARY_PREVIEW);

  // La tâche sélectionnée doit suivre les mutations : on la relit dans la liste
  // à jour plutôt que de figer l'objet capturé au clic.
  const openTask = selectedTask ? (tasks.find((x) => x.id === selectedTask.id) ?? null) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {dash.isBlank ? (
        <BlankStateCard onStart={() => onAction({ kind: "newSession", agentId: "pm" })} />
      ) : (
        <KpiRow dash={dash} isMobile={isMobile} onAction={onAction} />
      )}

      <StageCard project={project} onStageChange={onStageChange} />

      {dash.alerts.length > 0 && (
        <Section title="Points de vigilance" icon="warning">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dash.alerts.map((a) => (
              <AlertRow key={a.id} alert={a} onAction={onAction} />
            ))}
          </div>
        </Section>
      )}

      {!dash.isBlank && (
        <Section title="Prochaines échéances" icon="clock">
          {dash.upcoming.length === 0 ? (
            <Empty>
              Aucune échéance planifiée. Ajoutez des dates à vos tâches pour voir ce qui arrive.
            </Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dash.upcoming.map((task) => (
                <UpcomingRow key={task.id} task={task} onOpen={() => setSelectedTask(task)} />
              ))}
            </div>
          )}
        </Section>
      )}

      {!dash.isBlank && dash.activity.length > 0 && (
        <Section title="Activité récente" icon="refresh">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {dash.activity.map((item) => {
              const body = (
                <>
                  <span style={{ fontWeight: 700, color: C.text }}>{item.label}</span>
                  <span style={{ color: C.textMute }}> — </span>
                  <span style={{ color: C.textSub }}>{item.detail}</span>
                </>
              );
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "6px 2px",
                    fontSize: 12.5,
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {item.sessionId ? (
                      <button
                        onClick={() => onOpenSession(item.sessionId!)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: "inherit",
                        }}
                      >
                        {body}
                      </button>
                    ) : (
                      body
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: C.textMute, whiteSpace: "nowrap" }}>
                    {formatRelative(item.ts, { absoluteAfterWeek: true })}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Sessions du projet */}
      {sessions.length > 0 && (
        <Section title={`Sessions (${sessions.length})`} icon="msgSquare" id="sessions">
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
                      {isPanel ? `Panel · ${s.panel_agent_ids?.length} agents` : agent?.name} ·{" "}
                      {formatRelative(s.updated_at, { absoluteAfterWeek: true })}
                    </div>
                  </div>
                  <Icon name="chevRight" size={12} color={C.textMute} />
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Glossaire du projet — termes techniques déjà expliqués */}
      {glossary.length > 0 && (
        <Section title={`Glossaire (${glossary.length})`} icon="book">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {shownGlossary.map((g) => (
              <div
                key={g.term}
                style={{
                  padding: "9px 12px",
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{g.term}</span>
                <div style={{ fontSize: 12.5, color: C.textSub, marginTop: 2, lineHeight: 1.45 }}>
                  {g.definition}
                </div>
              </div>
            ))}
          </div>
          {glossary.length > GLOSSARY_PREVIEW && !glossaryExpanded && (
            <button
              onClick={() => setGlossaryExpanded(true)}
              style={{
                marginTop: 8,
                background: "none",
                border: "none",
                color: C.navy,
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                padding: "4px 0",
              }}
            >
              Afficher les {glossary.length} termes
            </button>
          )}
        </Section>
      )}

      {openTask && (
        <TaskDetailModal
          task={openTask}
          onClose={() => setSelectedTask(null)}
          onSetStatus={(s) => t.setStatus(openTask, s)}
          onSetPriority={(p) => t.setPriority(openTask, p)}
          onSetStart={(d) => t.setStartDate(openTask, d)}
          onSetDue={(d) => t.setDueDate(openTask, d)}
          onSetContent={(c) => t.setContent(openTask, c)}
          onDelete={() => {
            t.removeTask(openTask);
            setSelectedTask(null);
          }}
          onOpenSession={onOpenSession}
          onAddComment={(c) => t.addComment(openTask, c)}
          onEditComment={(id, c) => t.editComment(openTask, id, c)}
          onDeleteComment={(id) => t.deleteComment(openTask, id)}
        />
      )}
    </div>
  );
}

// --- Blocs ----------------------------------------------------------------

function KpiRow({
  dash,
  isMobile,
  onAction,
}: {
  dash: ReturnType<typeof buildDashboard>;
  isMobile: boolean;
  onAction: (a: DashboardAction) => void;
}) {
  const { kpis } = dash;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
        gap: 10,
      }}
    >
      <KpiTile
        label="Avancement"
        value={kpis.progress === null ? "—" : `${kpis.progress} %`}
        hint={kpis.total === 0 ? "rien de planifié" : `${kpis.done} / ${kpis.total} tâches`}
        onClick={() => onAction({ kind: "tasks", filter: "all" })}
      />
      <KpiTile
        label="En retard"
        value={String(kpis.overdue)}
        hint="à traiter en priorité"
        // Seule tuile qui change de couleur : une alerte visuelle à la fois.
        accent={kpis.overdue > 0 ? "#DC2626" : undefined}
        onClick={() => onAction({ kind: "tasks", filter: "overdue" })}
      />
      <KpiTile
        label="Cette semaine"
        value={String(kpis.week)}
        hint="échéances à 7 jours"
        onClick={() => onAction({ kind: "tasks", filter: "week" })}
      />
      <KpiTile
        label="Livrables"
        value={String(kpis.deliverables)}
        hint="produits par vos agents"
        href="#sessions"
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  accent,
  onClick,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent ?? C.text, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent ?? C.textSub, marginTop: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: C.textMute, marginTop: 1 }}>{hint}</div>
    </>
  );
  const style = {
    display: "block",
    textAlign: "left",
    width: "100%",
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: "12px 14px",
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "none",
  } as const;

  if (href) {
    return (
      <a href={href} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <button onClick={onClick} style={style}>
      {inner}
    </button>
  );
}

function StageCard({
  project,
  onStageChange,
}: {
  project: Project;
  onStageChange: (s: StageId) => void;
}) {
  const meta = stageMeta(project.stage);
  const next = nextStage(project.stage);
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name={meta.icon as IconName} size={14} color={meta.color} />
        <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{meta.name}</span>
        <span style={{ fontSize: 11.5, color: C.textMute, fontWeight: 700 }}>
          {stageIndex(project.stage) + 1} / {STAGES.length}
        </span>
      </div>
      <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.5, marginTop: 8 }}>
        {meta.description}
      </div>
      {next && (
        <button
          onClick={() => onStageChange(next.id)}
          style={{
            marginTop: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: C.bg,
            color: C.navy,
            border: `1.5px solid ${C.border}`,
            borderRadius: 9,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Icon name="chevRight" size={11} color={C.navy} />
          Passer à : {next.name}
        </button>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  onAction,
}: {
  alert: DashboardAlert;
  onAction: (a: DashboardAction) => void;
}) {
  const color = ALERT_COLORS[alert.level];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: C.white,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <Icon name={alert.level === "warn" ? "warning" : "lightbulb"} size={13} color={color} />
      <span style={{ flex: 1, minWidth: 180, fontSize: 13, color: C.text, lineHeight: 1.45 }}>
        {alert.message}
      </span>
      <button
        onClick={() => onAction(alert.action)}
        style={{
          background: "none",
          border: "none",
          color,
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          padding: 0,
          whiteSpace: "nowrap",
        }}
      >
        {alert.actionLabel}
      </button>
    </div>
  );
}

function UpcomingRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const status = STATUS_META[task.status];
  const prio = PRIORITY_META[task.priority];
  const due = task.due_date ? dueDateMeta(task.due_date, task.status === "done") : null;
  return (
    <button
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "9px 12px",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: status.color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: C.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.content}
      </span>
      {prio && <Badge label={prio.label} color={prio.color} bg={prio.bg} icon="warning" />}
      {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
    </button>
  );
}

function BlankStateCard({ onStart }: { onStart: () => void }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "20px 22px",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
        Votre projet est créé. Et maintenant ?
      </div>
      <div style={{ fontSize: 13.5, color: C.textSub, lineHeight: 1.55, marginTop: 8, maxWidth: 560 }}>
        Démarrez une session avec <strong>Clara, cheffe de projet</strong> : elle vous posera
        quelques questions et vous proposera un premier plan d&apos;action, converti en tâches.
      </div>
      <button
        onClick={onStart}
        style={{
          marginTop: 14,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: C.navy,
          color: "white",
          border: "none",
          borderRadius: 9,
          padding: "9px 16px",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <Icon name="sparkles" size={12} color="white" />
        Démarrer avec Clara
      </button>
    </div>
  );
}

// --- Habillage ------------------------------------------------------------

function Section({
  title,
  icon,
  id,
  children,
}: {
  title: string;
  icon: IconName;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id}>
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
        <Icon name={icon} size={12} color={C.textSub} />
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: C.textMute, lineHeight: 1.5, padding: "4px 2px" }}>
      {children}
    </div>
  );
}
