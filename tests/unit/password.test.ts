import { describe, expect, it } from "vitest";
import {
  checkPasswordPolicy,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "@/core/password";

/**
 * Password hashing and policy — `ARCHITECTURE.md` §6.1 (Argon2id) and
 * `API.md` §2.4 API-Q5 (12–128 characters, differ from the current one).
 */
describe("password hashing", () => {
  it("hashes with Argon2id parameters from ARCHITECTURE §6.1", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(
      verifyPassword(hash, "correct horse battery staple"),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(hash, "correct horse battery stapl"),
    ).resolves.toBe(false);
  });

  it("uses a random salt per hash", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first).not.toBe(second);
  });

  it("treats a malformed stored hash as a wrong password, never a crash", async () => {
    await expect(verifyPassword("not-a-phc-string", "anything")).resolves.toBe(
      false,
    );
  });

  it("ships a dummy hash that verifies nothing", async () => {
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, "anything")).resolves.toBe(
      false,
    );
  });
});

describe("password policy (API-Q5)", () => {
  it("rejects fewer than 12 characters", () => {
    expect(checkPasswordPolicy("short")).toEqual({ code: "TOO_SHORT" });
  });

  it("rejects more than 128 characters", () => {
    expect(checkPasswordPolicy("a".repeat(129))).toEqual({ code: "TOO_LONG" });
  });

  it("accepts 12 to 128 characters with no composition rules", () => {
    expect(checkPasswordPolicy("abcdefghijkl")).toBeNull();
    expect(checkPasswordPolicy("a".repeat(128))).toBeNull();
  });

  it("rejects reusing the current password", () => {
    expect(checkPasswordPolicy("abcdefghijkl", "abcdefghijkl")).toEqual({
      code: "UNCHANGED",
    });
  });
});
