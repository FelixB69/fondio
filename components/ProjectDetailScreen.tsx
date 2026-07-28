"use client";

// Écran d'un projet : un header persistant (identité, étape, avancement) et deux
// onglets — « Vue d'ensemble » (le cockpit) et « Tâches » (le board).
//
// L'onglet actif et le filtre du board vivent dans l'URL (`?tab=`, `?filter=`),
// ce qui les rend partageables, restaure l'état après un F5 et permet aux tuiles
// du cockpit de renvoyer vers le board déjà filtré.
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { Project, ProjectSessionRow, STAGES, StageId, stageMeta } from "@/lib/projects";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { useTasks } from "@/lib/use-tasks";
import { FILTERS, TaskFilter } from "@/lib/tasks";
import { Icon, IconName } from "./Icon";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectTasksTab } from "./ProjectTasksTab";

type Tab = "overview" | "taches";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<ProjectSessionRow[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);

  // Le parent lit les tâches pour les compteurs du header et le badge d'onglet ;
  // chaque onglet appelle `useTasks` de son côté. La clé SWR est partagée, donc
  // ces appels se règlent sur un seul et même fetch réseau.
  const { tasks } = useTasks({ projectId });

  // --- État de navigation, dérivé de l'URL -------------------------------
  const tab: Tab = searchParams.get("tab") === "taches" ? "taches" : "overview";
  const filterParam = searchParams.get("filter");
  const filter: TaskFilter = FILTERS.some((f) => f.id === filterParam)
    ? (filterParam as TaskFilter)
    : "all";

  // Les valeurs par défaut (vue d'ensemble, filtre « Toutes ») sont retirées de
  // l'URL plutôt qu'écrites : une seule forme canonique par état.
  const setParams = useCallback(
    (next: { tab?: Tab; filter?: TaskFilter }, mode: "push" | "replace") => {
      const p = new URLSearchParams(searchParams.toString());
      if (next.tab !== undefined) {
        if (next.tab === "overview") p.delete("tab");
        else p.set("tab", next.tab);
      }
      if (next.filter !== undefined) {
        if (next.filter === "all") p.delete("filter");
        else p.set("filter", next.filter);
      }
      const qs = p.toString();
      router[mode](qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  // Changer d'onglet empile une entrée d'historique (le retour arrière ramène à
  // la vue d'ensemble) ; changer de filtre remplace, pour ne pas transformer le
  // bouton Précédent en annulation de chips.
  const goToTab = (next: Tab) => setParams({ tab: next }, "push");
  const setFilter = (next: TaskFilter) => setParams({ filter: next }, "replace");

  const load = useCallback(async () => {
    setProjectLoading(true);
    const [projRes, sessRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, icon, color, project_type, stage, glossary, created_at, updated_at")
        .eq("id", projectId)
        .single(),
      supabase
        .from("sessions")
        .select("id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .eq("project_id", projectId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false }),
    ]);
    setProject((projRes.data as Project | null) ?? null);
    setSessions((sessRes.data ?? []) as ProjectSessionRow[]);
    setProjectLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);
  const openCount = tasks.length - doneCount;

  const progress = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((doneCount / tasks.length) * 100);
  }, [tasks, doneCount]);

  const updateStage = async (stage: StageId) => {
    await supabase.from("projects").update({ stage }).eq("id", projectId);
    setProject((p) => (p ? { ...p, stage } : null));
  };

  if (!projectLoading && !project) {
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
          padding: isMobile ? "12px 16px 0" : "18px 28px 0",
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

        {project && meta && (
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
                        {doneCount} / {tasks.length} tâches · {progress}%
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

            {/* Stepper des étapes de livraison */}
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
              <span style={{ fontSize: 10.5, color: stageMeta(project.stage).color, marginLeft: 10, fontWeight: 700, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name={stageMeta(project.stage).icon as IconName} size={11} color={stageMeta(project.stage).color} /> {stageMeta(project.stage).name}
              </span>
            </div>

            {/* Progression des tâches */}
            {tasks.length > 0 && (
              <div
                style={{
                  height: 5,
                  background: C.bg,
                  borderRadius: 100,
                  overflow: "hidden",
                  margin: "14px 0 0",
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

            <TabBar tab={tab} openCount={openCount} onChange={goToTab} />
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {projectLoading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!projectLoading && project && tab === "overview" && (
          <ProjectOverviewTab project={project} sessions={sessions} onOpenSession={onOpenSession} />
        )}

        {!projectLoading && project && tab === "taches" && (
          <ProjectTasksTab
            projectId={projectId}
            filter={filter}
            onFilterChange={setFilter}
            onOpenSession={onOpenSession}
          />
        )}
      </div>
    </div>
  );
}

function TabBar({
  tab,
  openCount,
  onChange,
}: {
  tab: Tab;
  openCount: number;
  onChange: (t: Tab) => void;
}) {
  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "overview", label: "Vue d'ensemble" },
    { id: "taches", label: "Tâches", badge: openCount },
  ];
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 14 }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-current={active ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              borderBottom: `2px solid ${active ? C.navy : "transparent"}`,
              color: active ? C.navy : C.textSub,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t.label}
            {t.badge ? (
              <span
                style={{
                  background: active ? C.navyLight : C.bg,
                  color: active ? C.navy : C.textMute,
                  borderRadius: 100,
                  padding: "1px 7px",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
