import { describe, expect, it } from "vitest";
import { ChatMessage } from "./data";
import {
  buildProjectStateInstruction,
  computeStats,
  nextStage,
  stageIndex,
  stageMeta,
  XP_RULES,
} from "./projects";

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

describe("buildProjectStateInstruction", () => {
  it("décrit l'étape, l'avancement et les tâches ouvertes", () => {
    const block = buildProjectStateInstruction({
      name: "Mon site",
      stage: "dev",
      tasks: [
        { content: "Choisir l'hébergeur", status: "done" },
        { content: "Intégrer Stripe", status: "doing" },
        { content: "Rédiger les CGV", status: "todo" },
      ],
    });

    expect(block).toContain("« Mon site »");
    expect(block).toContain("Développement (3/6)");
    expect(block).toContain("1 tâche(s) faite(s) sur 3 (33 %)");
    // « en cours » listé avant « à faire ».
    expect(block.indexOf("[en cours] Intégrer Stripe")).toBeLessThan(
      block.indexOf("[à faire] Rédiger les CGV"),
    );
    // La tâche faite n'apparaît pas dans les tâches ouvertes.
    expect(block).not.toContain("Choisir l'hébergeur");
  });

  it("signale l'absence de tâches sans lister de section vide", () => {
    const block = buildProjectStateInstruction({ name: "Vide", stage: "cadrage", tasks: [] });
    expect(block).toContain("Cadrage (1/6)");
    expect(block).toContain("Aucune tâche enregistrée");
    expect(block).not.toContain("Tâches ouvertes");
  });

  it("tronque au-delà de 10 tâches ouvertes et résume le reste", () => {
    const tasks = Array.from({ length: 13 }, (_, i) => ({
      content: `Tâche ${i + 1}`,
      status: "todo" as const,
    }));
    const block = buildProjectStateInstruction({ name: "Gros", stage: "dev", tasks });
    expect(block).toContain("…et 3 autre(s).");
  });

  it("retombe sur la 1re étape pour un stage inconnu", () => {
    const block = buildProjectStateInstruction({ name: "X", stage: "ideation", tasks: [] });
    expect(block).toContain("Cadrage (1/6)");
  });
});
