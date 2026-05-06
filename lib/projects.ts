import { ChatMessage, ProjectType } from "./data";

export interface Project {
  id: string;
  name: string;
  emoji: string | null;
  project_type: ProjectType;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: StageId;
  name: string;
  emoji: string;
  minXp: number;
  color: string;
}

export type StageId = "ideation" | "validation" | "mvp" | "launch" | "traction";

export const STAGES: readonly Stage[] = [
  { id: "ideation",   name: "Idée",       emoji: "💡", minXp: 0,   color: "#94A3B8" },
  { id: "validation", name: "Validation", emoji: "🔍", minXp: 50,  color: "#7C3AED" },
  { id: "mvp",        name: "MVP",        emoji: "🚧", minXp: 150, color: "#D97706" },
  { id: "launch",     name: "Lancement",  emoji: "🚀", minXp: 300, color: "#E8396A" },
  { id: "traction",   name: "Traction",   emoji: "📈", minXp: 600, color: "#0E9F88" },
];

export const XP_RULES = {
  session: 10,
  deliverable: 5,
  taskDone: 15,
  challenger: 20,
} as const;

export interface ProjectStats {
  xp: number;
  stage: Stage;
  nextStage: Stage | null;
  progressToNext: number;
  sessionsCount: number;
  deliverablesCount: number;
  tasksDoneCount: number;
  challengerSessionsCount: number;
}

export function stageFromXp(xp: number): { stage: Stage; nextStage: Stage | null; progressToNext: number } {
  let current = STAGES[0];
  let next: Stage | null = STAGES[1] ?? null;
  for (let i = 0; i < STAGES.length; i++) {
    if (xp >= STAGES[i].minXp) {
      current = STAGES[i];
      next = STAGES[i + 1] ?? null;
    }
  }
  let progressToNext = 100;
  if (next) {
    const span = next.minXp - current.minXp;
    progressToNext = Math.min(100, Math.max(0, Math.round(((xp - current.minXp) / span) * 100)));
  }
  return { stage: current, nextStage: next, progressToNext };
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

  const { stage, nextStage, progressToNext } = stageFromXp(xp);

  return {
    xp,
    stage,
    nextStage,
    progressToNext,
    sessionsCount: sessions.length,
    deliverablesCount,
    tasksDoneCount,
    challengerSessionsCount,
  };
}

export const DEFAULT_EMOJIS = ["🎯", "🚀", "💡", "🌱", "💼", "✨", "🔥", "🧠", "📈", "🎨", "🛠️", "🌍"];
