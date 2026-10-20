import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  emptyResponse,
  parseUuid,
  requestMeta,
} from "@/core/http";
import {
  actorFromContext,
  requireRequestSession,
  unlockUser,
} from "@/modules/identity";

/** IDN-8 · `POST /api/users/{id}/unlock` (`API.md` §3.1). Clears the throttle row. */
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
    await unlockUser(
      actorFromContext(session.context),
      id,
      requestMeta(request, requestId),
    );
    return emptyResponse(204, requestId);
  });
}

export const GET = methodNotAllowed;
