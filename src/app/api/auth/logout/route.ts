import { handleRequest, methodNotAllowed } from "@/core/route";
import { assertSameOrigin, emptyResponse, requestMeta } from "@/core/http";
import { db } from "@/core/db";
import { clearSessionCookie, readSessionToken } from "@/core/session";
import { actorFromContext, logout } from "@/modules/identity";
import { resolveSession } from "@/modules/identity/session-service";

/**
 * AUTH-2 · `POST /api/auth/logout` (`API.md` §2.4).
 *
 * Idempotent: a missing, unknown or expired session still returns `204`
 * (AUTH-2). The audit row is written before the row is deleted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const token = readSessionToken(request.headers.get("cookie"));
    const resolved = token
      ? await resolveSession(db(), token)
      : ({ status: "missing" } as const);
    if (resolved.status === "ok") {
      await logout(
        actorFromContext(resolved.context),
        resolved.context.session.id,
        requestMeta(request, requestId),
      );
    }
    return emptyResponse(204, requestId, {
      "Set-Cookie": clearSessionCookie(),
    });
  });
}

export const GET = methodNotAllowed;
