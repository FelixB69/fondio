import { describe, expect, it, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", () => {
    const plain = "sk-ant-test-1234567890";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = "sk-ant-test-1234567890";
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptSecret("sk-ant-test");
    const tampered = encrypted.slice(0, -2) + "00";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
