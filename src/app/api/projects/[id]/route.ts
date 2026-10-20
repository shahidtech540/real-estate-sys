import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseJsonBody,
  parseUuid,
  requestMeta,
} from "@/core/http";
import { actorFromContext, requireRequestSession } from "@/modules/identity";
import { getProject, updateProject } from "@/modules/setup";
import { updateProjectSchema } from "@/modules/setup/schemas";

/**
 * SET-5 · `GET /api/projects/{id}` and SET-6 · `PATCH /api/projects/{id}`
 * (`API.md` §3.2).
 *
 * SET-5 is `inventory.read` (all roles); SET-6 is Admin through `setup.manage`
 * and carries the optimistic-concurrency `version` (`V-18`). Both capability
 * checks are inside the module functions.
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
    const { context: session } = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    return jsonResponse(
      await getProject(actorFromContext(session), id),
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
    const { context: session } = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    const input = await parseJsonBody(request, updateProjectSchema);
    const project = await updateProject(
      actorFromContext(session),
      id,
      input,
      requestMeta(request, requestId),
    );
    return jsonResponse(project, requestId);
  });
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
