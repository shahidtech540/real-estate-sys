import { sessionLifetimes } from "@/core/config";
import type { Db, Tx } from "@/core/db";
import type { Role } from "@/core/authz/policy";
import {
  createSessionToken,
  hashSessionToken,
  initialSessionExpiry,
  isSessionExpired,
  refreshedIdleExpiry,
} from "@/core/session";
import * as repo from "./repository";

/**
 * Session creation, resolution and revocation — `ARCHITECTURE.md` §6.1,
 * `API.md` §2.1. Pure expiry arithmetic lives in `core/session`; this file is
 * the database-backed half.
 */

export interface SessionContext {
  session: repo.SessionRecord;
  user: repo.UserRecord;
  role: Role;
}

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface IssuedSession {
  token: string;
  session: repo.SessionRecord;
}

/**
 * A login always mints a new row with a new token; no pre-auth session is ever
 * reused (`ARCHITECTURE.md` §6.1 rotation). The raw token is returned to the
 * route for the cookie only — it is never stored (`API.md` §2.1).
 */
export async function issueSession(
  tx: Tx,
  userId: string,
  meta: SessionMeta,
  now: Date = new Date(),
): Promise<IssuedSession> {
  const { idleMs, absoluteMs } = sessionLifetimes();
  const token = createSessionToken();
  const expiry = initialSessionExpiry(now, idleMs, absoluteMs);
  const session = await repo.insertSession(tx, {
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: expiry.idleExpiresAt,
    absoluteExpiresAt: expiry.absoluteExpiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { token, session };
}

export type ResolveResult =
  | { status: "ok"; context: SessionContext }
  | { status: "missing" }
  | { status: "expired" };

/**
 * Per-request resolution (`API.md` §2.1):
 * SHA-256(cookie) → `session` by `uq_session_token_hash` → reject revoked/idle/
 * absolute expiry → reject an inactive user.
 *
 * An expired or revoked row is deleted on sight; the nightly cleanup job exists
 * for rows nobody touches (`ARCHITECTURE.md` §6.1).
 */
export async function resolveSession(
  client: Db,
  token: string | undefined,
  now: Date = new Date(),
): Promise<ResolveResult> {
  if (!token) return { status: "missing" };
  const tokenHash = hashSessionToken(token);
  const found = await repo.findSessionWithUser(client, tokenHash);
  if (!found) return { status: "missing" };

  if (isSessionExpired(found.session, now) || !found.user.isActive) {
    await repo.deleteSessionById(client, found.session.id);
    return { status: "expired" };
  }

  return {
    status: "ok",
    context: {
      session: found.session,
      user: found.user,
      role: found.user.role,
    },
  };
}

/**
 * AUTH-4: slides the idle window and never extends the absolute cap
 * (`idle = LEAST(now + 30m, absolute)`).
 */
export async function refreshSession(
  client: Db,
  context: SessionContext,
  now: Date = new Date(),
): Promise<SessionContext> {
  const { idleMs } = sessionLifetimes();
  const idleExpiresAt = refreshedIdleExpiry(
    now,
    context.session.absoluteExpiresAt,
    idleMs,
  );
  await repo.touchSession(client, context.session.id, now, idleExpiresAt);
  return {
    ...context,
    session: { ...context.session, lastSeenAt: now, idleExpiresAt },
  };
}

/**
 * Password change, reset, deactivation and role change revoke immediately
 * (`ARCHITECTURE.md` §6.1). Password change keeps the acting session.
 */
export async function revokeOthers(
  tx: Tx,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await repo.deleteOtherSessions(tx, userId, keepSessionId);
}

export async function revokeAll(tx: Tx, userId: string): Promise<void> {
  await repo.deleteSessionsForUser(tx, userId);
}
