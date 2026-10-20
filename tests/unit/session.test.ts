import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  initialSessionExpiry,
  isSessionExpired,
  readSessionToken,
  refreshedIdleExpiry,
  SESSION_COOKIE,
  serializeSessionCookie,
} from "@/core/session";

/**
 * Session primitives — `ARCHITECTURE.md` §6.1 and `API.md` §2.1, §1.10.
 * The token is opaque, only its SHA-256 is stored, idle 30 min, absolute 12 h.
 */
const IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 12 * 60 * 60_000;

describe("session token", () => {
  it("is 32 random bytes, base64url encoded", () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(createSessionToken()).not.toBe(token);
  });

  it("stores only the SHA-256 hex of the token", () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe("expiry", () => {
  const created = new Date("2026-10-20T09:00:00.000Z");

  it("sets idle = created + 30m and absolute = created + 12h", () => {
    const expiry = initialSessionExpiry(created, IDLE_MS, ABSOLUTE_MS);
    expect(expiry.idleExpiresAt.toISOString()).toBe("2026-10-20T09:30:00.000Z");
    expect(expiry.absoluteExpiresAt.toISOString()).toBe(
      "2026-10-20T21:00:00.000Z",
    );
  });

  it("slides the idle window but never past the absolute cap", () => {
    const absolute = new Date("2026-10-20T21:00:00.000Z");
    expect(
      refreshedIdleExpiry(
        new Date("2026-10-20T10:00:00.000Z"),
        absolute,
        IDLE_MS,
      ),
    ).toEqual(new Date("2026-10-20T10:30:00.000Z"));
    // 20:50 + 30m would pass 21:00, so it stops at the cap.
    expect(
      refreshedIdleExpiry(
        new Date("2026-10-20T20:50:00.000Z"),
        absolute,
        IDLE_MS,
      ),
    ).toEqual(absolute);
  });

  it("expires exactly at the boundary, matching the SQL `<=`", () => {
    const session = {
      revokedAt: null,
      idleExpiresAt: new Date("2026-10-20T09:30:00.000Z"),
      absoluteExpiresAt: new Date("2026-10-20T21:00:00.000Z"),
    };
    expect(
      isSessionExpired(session, new Date("2026-10-20T09:29:59.999Z")),
    ).toBe(false);
    expect(
      isSessionExpired(session, new Date("2026-10-20T09:30:00.000Z")),
    ).toBe(true);
    expect(
      isSessionExpired(session, new Date("2026-10-20T21:00:00.000Z")),
    ).toBe(true);
    expect(
      isSessionExpired(
        { ...session, revokedAt: new Date("2026-10-20T09:10:00.000Z") },
        new Date("2026-10-20T09:11:00.000Z"),
      ),
    ).toBe(true);
  });
});

describe("cookie", () => {
  it("has every __Host- requirement: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", () => {
    const cookie = serializeSessionCookie("token-value");
    expect(cookie.startsWith(`${SESSION_COOKIE}=token-value`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain");
  });

  it("clears with Max-Age=0", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("reads the token from a cookie header and ignores look-alikes", () => {
    expect(readSessionToken(`${SESSION_COOKIE}=abc; other=1`)).toBe("abc");
    expect(readSessionToken("other=1")).toBeUndefined();
    expect(readSessionToken(null)).toBeUndefined();
  });
});
