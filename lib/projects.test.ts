import { describe, expect, it } from "vitest";
import { ChatMessage } from "./data";
import { computeStats, nextStage, stageIndex, stageMeta, XP_RULES } from "./projects";

describe("stage helpers", () => {
  it("mappe une étape stockée vers sa méta", () => {
    expect(stageMeta("dev").name).toBe("Développement");
    expect(stageIndex("dev")).toBe(2);
    expect(nextStage("dev")?.id).toBe("recette");
  });

  it("retombe sur la 1re étape pour une valeur héritée/inconnue", () => {
    expect(stageMeta("ideation").id).toBe("cadrage");
    expect(stageIndex("ideation")).toBe(0);
    expect(stageMeta(null).id).toBe("cadrage");
  });

  it("n'a pas d'étape suivante après la dernière", () => {
    expect(nextStage("maintenance")).toBeNull();
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
