import { AgentId, ChatMessage, ProjectType, TaskStatus } from "./data";
import { GlossaryEntry } from "./glossary";

export interface Project {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  project_type: ProjectType;
  stage: StageId;
  // Glossaire pédagogique persistant (termes déjà expliqués). Optionnel : absent
  // des lignes chargées avant la migration Étape 4.
  glossary?: GlossaryEntry[];
  created_at: string;
  updated_at: string;
}

// Session telle que l'écran projet la charge : assez pour la lister et pour
// alimenter computeStats. Partagée entre ProjectDetailScreen (qui la charge) et
// ProjectOverviewTab (qui l'affiche), d'où sa place ici plutôt que dans un
// composant — c'est une forme de données, pas du JSX.
export interface ProjectSessionRow {
  id: string;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  updated_at: string;
  panel_agent_ids?: string[] | null;
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

// Forme minimale d'une tâche pour décrire l'état du projet dans le prompt.
// (Sous-ensemble de `Task` — on ne veut que le contenu et le statut, comme
// `buildKnownTermsInstruction` ne prend que les termes.)
export interface ProjectStateTask {
  content: string;
  status: TaskStatus;
}

// Nombre max de tâches ouvertes listées dans le prompt (budget de tokens pour
// le modèle local). Au-delà, on résume « …et N autres ».
const MAX_STATE_TASKS = 10;

// Bloc de prompt décrivant l'ÉTAT ACTUEL du projet (étape de livraison,
// avancement, tâches ouvertes) pour que l'agent conseille en connaissance de
// cause : ne pas reproposer ce qui est fait/tranché, enchaîner sur la suite
// logique de l'étape. Vide si aucun projet rattaché (rien à dire).
export function buildProjectStateInstruction(input: {
  name: string;
  stage: string | null | undefined;
  tasks: ProjectStateTask[];
}): string {
  const meta = stageMeta(input.stage);
  const stageNo = stageIndex(input.stage) + 1;
  const total = input.tasks.length;
  const done = input.tasks.filter((t) => t.status === "done").length;
  const open = input.tasks.filter((t) => t.status !== "done");

  const lines: string[] = [
    `ÉTAT ACTUEL DU PROJET « ${input.name} » — contexte à respecter. Ne repropose pas ce qui est déjà fait ou tranché ; enchaîne sur la suite logique compte tenu de l'étape, sans redemander ce qui est déjà connu.`,
    `- Étape de livraison : ${meta.name} (${stageNo}/${STAGES.length}).`,
  ];

  if (total > 0) {
    const pct = Math.round((done / total) * 100);
    lines.push(`- Avancement : ${done} tâche(s) faite(s) sur ${total} (${pct} %).`);
  } else {
    lines.push(`- Aucune tâche enregistrée pour l'instant.`);
  }

  if (open.length > 0) {
    // « en cours » avant « à faire » : ce qui est actif d'abord.
    const ordered = [...open].sort(
      (a, b) => Number(b.status === "doing") - Number(a.status === "doing"),
    );
    const shown = ordered.slice(0, MAX_STATE_TASKS);
    lines.push(`- Tâches ouvertes :`);
    for (const t of shown) {
      lines.push(`  • [${t.status === "doing" ? "en cours" : "à faire"}] ${t.content}`);
    }
    if (open.length > shown.length) {
      lines.push(`  • …et ${open.length - shown.length} autre(s).`);
    }
  }

  return lines.join("\n");
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
