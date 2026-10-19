import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  emptyResponse,
  parseJsonBody,
  requestMeta,
} from "@/core/http";
import {
  actorFromContext,
  changePassword,
  requireRequestSession,
} from "@/modules/identity";
import { changePasswordSchema } from "@/modules/identity/schemas";

/**
 * AUTH-5 · `POST /api/auth/password` (`API.md` §2.4).
 *
 * Works while `must_change_password = true` — it is the endpoint that clears it.
 * All other sessions are deleted; this one stays valid.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context } = await requireRequestSession(request, {
      allowWhenPasswordChangeRequired: true,
    });
    const input = await parseJsonBody(request, changePasswordSchema);
    await changePassword(
      actorFromContext(context),
      context.session.id,
      input,
      requestMeta(request, requestId),
    );
    return emptyResponse(204, requestId);
  });
}

export const GET = methodNotAllowed;
