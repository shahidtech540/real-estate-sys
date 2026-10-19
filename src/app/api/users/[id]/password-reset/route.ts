import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseUuid,
  requestMeta,
} from "@/core/http";
import {
  actorFromContext,
  requireRequestSession,
  resetPassword,
} from "@/modules/identity";

/**
 * IDN-7 · `POST /api/users/{id}/password-reset` (`API.md` §3.1).
 *
 * Returns the generated 16-character password **once**; it is never logged,
 * never stored in plaintext and never written to the audit summary.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const session = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    const result = await resetPassword(
      actorFromContext(session.context),
      id,
      requestMeta(request, requestId),
    );
    return jsonResponse(result, requestId);
  });
}

export const GET = methodNotAllowed;
