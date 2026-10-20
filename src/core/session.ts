import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session primitives — `ARCHITECTURE.md` §6.1 and `API.md` §2.1/§1.10.
 *
 * Pure functions only: no database, no request. The Identity module persists
 * what these produce; the route layer reads and writes the cookie.
 */

/** `__Host-` prefix: Secure, Path=/, no Domain — `ARCHITECTURE.md` §6.1. */
export const SESSION_COOKIE = "__Host-spm_session";

/** 32 random bytes, base64url — `API.md` §1.10. */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of the token; only this value is stored (`DATABASE.md` §3.1). */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison, used where a token is compared rather than hashed. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SessionExpiry {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

/**
 * `idle = now + 30 min`, `absolute = now + 12 h` (`API.md` §2.1).
 * `ck_session_expiry_order` requires both to be after `created_at`; callers pass
 * the same instant for `now` and the row's `created_at` when inserting.
 */
export function initialSessionExpiry(
  now: Date,
  idleMs: number,
  absoluteMs: number,
): SessionExpiry {
  return {
    idleExpiresAt: new Date(now.getTime() + idleMs),
    absoluteExpiresAt: new Date(now.getTime() + absoluteMs),
  };
}

/**
 * Refresh slides the idle window and **never** extends the absolute cap
 * (`API.md` §2.1, AUTH-4):
 * `idle_expires_at = LEAST(now() + 30 minutes, absolute_expires_at)`.
 */
export function refreshedIdleExpiry(
  now: Date,
  absoluteExpiresAt: Date,
  idleMs: number,
): Date {
  const slid = new Date(now.getTime() + idleMs);
  return slid.getTime() < absoluteExpiresAt.getTime()
    ? slid
    : absoluteExpiresAt;
}

export interface SessionLike {
  revokedAt: Date | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

/**
 * A session is unusable when revoked, idle-expired or past its absolute cap
 * (`API.md` §2.1: "reject if revoked_at IS NOT NULL, idle_expires_at <= now(),
 * or absolute_expires_at <= now()"). Boundaries are inclusive-expired, matching
 * the SQL `<=`.
 */
export function isSessionExpired(session: SessionLike, now: Date): boolean {
  return (
    session.revokedAt !== null ||
    session.idleExpiresAt.getTime() <= now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime()
  );
}

export interface CookieOptions {
  maxAgeSeconds?: number;
}

/**
 * Serializes the session cookie. `Secure` is always on: `__Host-` requires it,
 * and TLS terminates at Nginx (`ARCHITECTURE.md` §6.4). Browsers treat
 * `http://localhost` as a secure context for cookie purposes.
 */
export function serializeSessionCookie(
  token: string,
  options: CookieOptions = {},
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (options.maxAgeSeconds !== undefined)
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join("; ");
}

/** Clears the cookie (`Max-Age=0`) — AUTH-2. */
export function clearSessionCookie(): string {
  return serializeSessionCookie("", { maxAgeSeconds: 0 });
}

/** Minimal RFC 6265 parser; returns the raw token when present. */
export function readSessionToken(
  cookieHeader: string | null,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}
