import { cookies } from "next/headers";
import { AppError } from "@/core/errors";
import { db } from "@/core/db";
import { readSessionToken, SESSION_COOKIE } from "@/core/session";
import type { Capability } from "@/core/authz/policy";
import { requireCapability } from "@/core/authz/policy";
import { resolveSession, type SessionContext } from "./session-service";

/**
 * The route/page adapter layer of `ARCHITECTURE.md` §6.3 (layer 2). It is a
 * convenience for handlers, never the security boundary: every command and
 * query re-checks the capability itself (`AGENTS.md` §5.3).
 */

export interface RequestSessionOptions {
  /**
   * `false` for the five endpoints exempt from the forced-change gate
   * (`API.md` §2.3): AUTH-2/3/4/5 and `GET /api/health` (which has no session at
   * all). Every other endpoint leaves this at its default and is blocked with
   * `403 PASSWORD_CHANGE_REQUIRED`.
   */
  allowWhenPasswordChangeRequired?: boolean;
}

export interface AuthedRequest {
  context: SessionContext;
  /** Raw cookie value — needed by logout; never logged. */
  token: string;
}

export async function requireRequestSession(
  request: Request,
  options: RequestSessionOptions = {},
): Promise<AuthedRequest> {
  const token = readSessionToken(request.headers.get("cookie"));
  if (!token) throw new AppError("AUTH_REQUIRED");

  const resolved = await resolveSession(db(), token);
  if (resolved.status === "missing") throw new AppError("AUTH_REQUIRED");
  if (resolved.status === "expired") throw new AppError("AUTH_SESSION_EXPIRED");

  // Capability-independent gate; applies to Admins too (`API.md` §2.3).
  if (
    resolved.context.user.mustChangePassword &&
    !options.allowWhenPasswordChangeRequired
  ) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED");
  }
  return { context: resolved.context, token };
}

/** Layer-2 capability check for a route; the command repeats it. */
export function assertCapability(
  context: SessionContext,
  capability: Capability,
): void {
  requireCapability({ role: context.role }, capability);
}

/**
 * Server-component session lookup for the `(app)` layout. Returns `null` rather
 * than throwing so the layout can `redirect('/login')`.
 */
export async function getPageSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const resolved = await resolveSession(db(), token);
  return resolved.status === "ok" ? resolved.context : null;
}
