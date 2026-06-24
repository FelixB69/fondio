import { beforeAll, describe, expect, it } from "vitest";
import { loadUserByokConfig } from "./byok";
import { encryptSecret } from "./crypto";

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

function fakeSupabase(profileRow: unknown, keyRow: unknown) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { single: async () => ({ data: keyRow }) };
                },
                single: async () => ({ data: table === "profiles" ? profileRow : keyRow }),
              };
            },
          };
        },
      };
    },
  };
}

describe("loadUserByokConfig", () => {
  it("returns null when the user has no preferred provider", async () => {
    const supabase = fakeSupabase({ preferred_ai_provider: null }, null);
    const result = await loadUserByokConfig(supabase, "user-1");
    expect(result).toBeNull();
  });

  it("returns the decrypted key when a preference and a matching key exist", async () => {
    const encrypted = encryptSecret("sk-ant-real-key");
    const supabase = fakeSupabase(
      { preferred_ai_provider: "anthropic" },
      { encrypted_key: encrypted },
    );
    const result = await loadUserByokConfig(supabase, "user-1");
    expect(result).toEqual({ provider: "anthropic", apiKey: "sk-ant-real-key" });
  });

  it("returns null when the preference is set but no key row exists", async () => {
    const supabase = fakeSupabase({ preferred_ai_provider: "anthropic" }, null);
    const result = await loadUserByokConfig(supabase, "user-1");
    expect(result).toBeNull();
  });
});
