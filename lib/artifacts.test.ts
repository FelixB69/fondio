import { describe, expect, it } from "vitest";
import { selectRecentContext } from "./artifacts";
import type { ChatMessage } from "./data";

function msg(content: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return { role, content, ts: "2026-06-26T00:00:00.000Z" };
}

describe("selectRecentContext", () => {
  it("garde tous les messages si le total est sous le budget", () => {
    const conversation = [msg("a"), msg("b"), msg("c")];
    expect(selectRecentContext(conversation)).toEqual(conversation);
  });

  it("coupe les messages les plus anciens quand le budget est dépassé", () => {
    const old = msg("x".repeat(7000));
    const recent1 = msg("y".repeat(3000));
    const recent2 = msg("z".repeat(3000));
    const conversation = [old, recent1, recent2];
    const result = selectRecentContext(conversation);
    expect(result).toEqual([recent1, recent2]);
  });

  it("garde toujours au moins le dernier message même s'il dépasse seul le budget", () => {
    const huge = msg("x".repeat(9000));
    const conversation = [msg("a"), huge];
    expect(selectRecentContext(conversation)).toEqual([huge]);
  });

  it("préserve l'ordre chronologique des messages sélectionnés", () => {
    const conversation = [msg("a", "user"), msg("b", "assistant"), msg("c", "user")];
    const result = selectRecentContext(conversation);
    expect(result.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });
});
