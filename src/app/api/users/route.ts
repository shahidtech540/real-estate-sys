import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseJsonBody,
  parseWith,
  queryObject,
  requestMeta,
} from "@/core/http";
import {
  actorFromContext,
  createUser,
  listUsers,
  requireRequestSession,
} from "@/modules/identity";
import {
  createUserSchema,
  listUsersQuerySchema,
} from "@/modules/identity/schemas";

/**
 * IDN-3 · `GET /api/users` and IDN-4 · `POST /api/users` (`API.md` §3.1).
 * Both are Admin-only through `user.manage`; the query/command re-checks it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    const { context } = await requireRequestSession(request);
    const query = parseWith(listUsersQuerySchema, queryObject(request.url));
    return jsonResponse(
      await listUsers(actorFromContext(context), query),
      requestId,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context } = await requireRequestSession(request);
    const input = await parseJsonBody(request, createUserSchema);
    const user = await createUser(
      actorFromContext(context),
      input,
      requestMeta(request, requestId),
    );
    return jsonResponse(user, requestId, { status: 201 });
  });
}

export const PATCH = methodNotAllowed;
