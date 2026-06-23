import { describe, expect, it } from "vitest";
import { ChatMessage } from "./data";
import { computeStats, stageFromXp, XP_RULES } from "./projects";

describe("stageFromXp", () => {
  it("démarre au stade Idée à 0 XP", () => {
    const r = stageFromXp(0);
    expect(r.stage.id).toBe("ideation");
    expect(r.nextStage?.id).toBe("validation");
  });

  it("passe au stade supérieur au seuil exact", () => {
    expect(stageFromXp(50).stage.id).toBe("validation");
    expect(stageFromXp(150).stage.id).toBe("mvp");
    expect(stageFromXp(600).stage.id).toBe("traction");
  });

  it("plafonne au dernier stade sans stade suivant", () => {
    const r = stageFromXp(10000);
    expect(r.stage.id).toBe("traction");
    expect(r.nextStage).toBeNull();
    expect(r.progressToNext).toBe(100);
  });

  it("calcule une progression intermédiaire bornée 0–100", () => {
    // À mi-chemin entre ideation (0) et validation (50).
    expect(stageFromXp(25).progressToNext).toBe(50);
  });
});

describe("computeStats", () => {
  function assistantMsg(deliverables: string[]): ChatMessage {
    return { role: "assistant", content: "x", deliverables, ts: "2026-01-01T00:00:00Z" };
  }

  it("agrège XP à partir des sessions, livrables, tâches faites et challenger", () => {
    const sessions = [
      { challenger_mode: true, messages: [assistantMsg(["a", "b"])] },
      { challenger_mode: false, messages: [assistantMsg(["c"])] },
    ];
    const stats = computeStats(sessions, 2);

    expect(stats.sessionsCount).toBe(2);
    expect(stats.deliverablesCount).toBe(3);
    expect(stats.challengerSessionsCount).toBe(1);
    expect(stats.tasksDoneCount).toBe(2);

    const expectedXp =
      2 * XP_RULES.session +
      3 * XP_RULES.deliverable +
      2 * XP_RULES.taskDone +
      1 * XP_RULES.challenger;
    expect(stats.xp).toBe(expectedXp);
  });

  it("gère l'absence de messages / livrables sans planter", () => {
    const stats = computeStats([{ challenger_mode: false, messages: [] }], 0);
    expect(stats.deliverablesCount).toBe(0);
    expect(stats.xp).toBe(XP_RULES.session);
  });
});
