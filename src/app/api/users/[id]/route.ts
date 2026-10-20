import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseJsonBody,
  parseUuid,
  requestMeta,
} from "@/core/http";
import {
  actorFromContext,
  getUser,
  requireRequestSession,
  updateUser,
} from "@/modules/identity";
import { updateUserSchema } from "@/modules/identity/schemas";

/**
 * IDN-5 · `GET /api/users/{id}` and IDN-6 · `PATCH /api/users/{id}`
 * (`API.md` §3.1). Admin-only through `user.manage`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    const session = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    return jsonResponse(
      await getUser(actorFromContext(session.context), id),
      requestId,
    );
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const session = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    const input = await parseJsonBody(request, updateUserSchema);
    const user = await updateUser(
      actorFromContext(session.context),
      id,
      input,
      requestMeta(request, requestId),
    );
    return jsonResponse(user, requestId);
  });
}

export const POST = methodNotAllowed;
