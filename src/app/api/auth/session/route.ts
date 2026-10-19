import { handleRequest, methodNotAllowed } from "@/core/route";
import { jsonResponse } from "@/core/http";
import { requireRequestSession, sessionInfo } from "@/modules/identity";

/**
 * AUTH-3 · `GET /api/auth/session` (`API.md` §2.4).
 *
 * Read-only: it does not touch `last_seen_at` (that is AUTH-4) and it is one of
 * the five endpoints exempt from the `PASSWORD_CHANGE_REQUIRED` gate
 * (`API.md` §2.3).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    const { context } = await requireRequestSession(request, {
      allowWhenPasswordChangeRequired: true,
    });
    return jsonResponse(sessionInfo(context), requestId);
  });
}

export const POST = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
