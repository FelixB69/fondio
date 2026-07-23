import { ChatMessage, ProjectType } from "./data";

export interface Project {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  project_type: ProjectType;
  stage: StageId;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: StageId;
  name: string;
  icon: string;
  color: string;
}

// Cycle de livraison d'un projet tech. L'étape est un STATUT stocké dans
// project.stage, réglé manuellement (clic sur le stepper) — elle n'est PLUS
// dérivée de l'XP. L'avancement affiché se calcule sur les tâches faites.
export type StageId = "cadrage" | "conception" | "dev" | "recette" | "prod" | "maintenance";

export const STAGES: readonly Stage[] = [
  { id: "cadrage",     name: "Cadrage",       icon: "target",  color: "#94A3B8" },
  { id: "conception",  name: "Conception",    icon: "pencil",  color: "#7C3AED" },
  { id: "dev",         name: "Développement", icon: "code",    color: "#0EA5E9" },
  { id: "recette",     name: "Recette",       icon: "search",  color: "#D97706" },
  { id: "prod",        name: "Mise en ligne", icon: "rocket",  color: "#E8396A" },
  { id: "maintenance", name: "Maintenance",   icon: "refresh", color: "#0E9F88" },
];

export const DEFAULT_STAGE: StageId = "cadrage";

// Helpers étape. Tolérants aux valeurs héritées/inconnues (fallback 1re étape)
// pour ne jamais crasher sur une donnée pré-migration.
export function stageMeta(stage: string | null | undefined): Stage {
  return STAGES.find((s) => s.id === stage) ?? STAGES[0];
}
export function stageIndex(stage: string | null | undefined): number {
  const i = STAGES.findIndex((s) => s.id === stage);
  return i < 0 ? 0 : i;
}
export function nextStage(stage: string | null | undefined): Stage | null {
  return STAGES[stageIndex(stage) + 1] ?? null;
}

export const XP_RULES = {
  session: 10,
  deliverable: 5,
  taskDone: 15,
  challenger: 20,
} as const;

export interface ProjectStats {
  // XP conservé comme indicateur d'activité (déco), plus lié à l'étape.
  xp: number;
  sessionsCount: number;
  deliverablesCount: number;
  tasksDoneCount: number;
  challengerSessionsCount: number;
}

interface SessionForStats {
  challenger_mode: boolean;
  messages: ChatMessage[];
}

export function computeStats(
  sessions: SessionForStats[],
  tasksDoneCount: number,
): ProjectStats {
  let deliverablesCount = 0;
  let challengerSessionsCount = 0;
  for (const s of sessions) {
    if (s.challenger_mode) challengerSessionsCount += 1;
    const msgs = Array.isArray(s.messages) ? s.messages : [];
    for (const m of msgs) {
      if (m.role === "assistant" && Array.isArray(m.deliverables)) {
        deliverablesCount += m.deliverables.length;
      }
    }
  }

  const xp =
    sessions.length * XP_RULES.session +
    deliverablesCount * XP_RULES.deliverable +
    tasksDoneCount * XP_RULES.taskDone +
    challengerSessionsCount * XP_RULES.challenger;

  return {
    xp,
    sessionsCount: sessions.length,
    deliverablesCount,
    tasksDoneCount,
    challengerSessionsCount,
  };
}

export const PROJECT_ICONS = [
  "target", "rocket", "lightbulb", "briefcase", "code", "chart",
  "zap", "sparkles", "building", "sprout", "key", "globe",
  "pencil", "book", "star", "layers", "hammer", "server",
] as const;

export const PROJECT_COLORS = [
  "#E8396A", "#7C3AED", "#0E9F88", "#D97706", "#0EA5E9", "#264573",
  "#16A34A", "#DC2626", "#EC4899", "#9333EA", "#0891B2", "#B45309",
];
