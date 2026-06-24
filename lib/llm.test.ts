import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __callAnthropicJsonForTest as callAnthropicJson } from "./llm";
import { __callOpenAICompatibleJsonForTest as callOpenAICompatibleJson } from "./llm";
import { __callGoogleJsonForTest as callGoogleJson } from "./llm";
import { callChatModel, testByokKey } from "./llm";

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

describe("OpenAI-compatible adapter — callOpenAICompatibleJson", () => {
  it("posts to {baseUrl}/chat/completions with Bearer auth", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Bonjour" } }] }),
    });

    const result = await callOpenAICompatibleJson(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o-mini",
      [{ role: "user", content: "Salut" }],
    );

    expect(result).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("throws on empty response", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }) });
    await expect(
      callOpenAICompatibleJson("https://api.openai.com/v1", "sk-test", "gpt-4o-mini", [
        { role: "user", content: "x" },
      ]),
    ).rejects.toThrow(/vide/);
  });
});

describe("Google Gemini adapter — callGoogleJson", () => {
  it("moves system messages into systemInstruction and maps assistant->model", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Bonjour" }] } }] }),
    });

    const result = await callGoogleJson(
      [
        { role: "system", content: "Tu es un assistant." },
        { role: "user", content: "Salut" },
      ],
      "AIza-test",
      "gemini-2.0-flash",
    );

    expect(result).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("gemini-2.0-flash:generateContent?key=AIza-test");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("Tu es un assistant.");
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Salut" }] }]);
  });
});

describe("callChatModel with byok", () => {
  it("uses the byok provider when configured and forceProvider is not 'local'", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Réponse Claude" }] }),
    });

    const result = await callChatModel([{ role: "user", content: "Salut" }], {
      byok: { provider: "anthropic", apiKey: "sk-ant-test" },
    });

    expect(result.provider).toBe("byok");
    expect(result.data).toBe("Réponse Claude");
  });

  it("falls back to local/cloud when the byok call fails, without throwing", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    // 1er appel : Anthropic échoue (clé invalide)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid" });
    // 2e appel : Ollama (local) injoignable
    fetchMock.mockRejectedValueOnce(new Error("fetch failed"));
    // 3e appel : Mistral Fondio répond
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Réponse Mistral" } }] }),
    });
    process.env.MISTRAL_API_KEY = "fondio-test-key";

    const result = await callChatModel([{ role: "user", content: "Salut" }], {
      byok: { provider: "anthropic", apiKey: "sk-ant-bad" },
    });

    expect(result.provider).toBe("cloud");
    expect(result.data).toBe("Réponse Mistral");
  });

  it("ignores byok when forceProvider is 'local'", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "Réponse locale" } }),
    });

    const result = await callChatModel([{ role: "user", content: "Salut" }], {
      byok: { provider: "anthropic", apiKey: "sk-ant-test" },
      forceProvider: "local",
    });

    expect(result.provider).toBe("local");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/chat"); // Ollama, pas Anthropic
  });
});

describe("testByokKey", () => {
  it("returns ok:true on a successful test call", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const result = await testByokKey("anthropic", "sk-ant-test");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with the error message on failure", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid" });
    const result = await testByokKey("anthropic", "sk-ant-bad");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/401/);
  });
});
