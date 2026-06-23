import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAnthropicJsonForTest as callAnthropicJson } from "./llm";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Anthropic adapter — callAnthropicJson", () => {
  it("sends system separately and parses text content blocks", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Bonjour" }] }),
    });

    const result = await callAnthropicJson(
      [
        { role: "system", content: "Tu es un assistant." },
        { role: "user", content: "Salut" },
      ],
      "sk-ant-test",
      "claude-sonnet-4-6",
    );

    expect(result).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("Tu es un assistant.");
    expect(body.messages).toEqual([{ role: "user", content: "Salut" }]);
  });

  it("throws with status on non-ok response", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid key" });
    await expect(
      callAnthropicJson([{ role: "user", content: "x" }], "bad-key", "claude-sonnet-4-6"),
    ).rejects.toThrow(/401/);
  });
});
