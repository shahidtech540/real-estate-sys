import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseJsonBody,
  parseWith,
  queryObject,
  requestMeta,
} from "@/core/http";
import { actorFromContext, requireRequestSession } from "@/modules/identity";
import { createProject, listProjects } from "@/modules/setup";
import {
  createProjectSchema,
  listProjectsQuerySchema,
} from "@/modules/setup/schemas";

/**
 * SET-3 · `GET /api/projects` and SET-4 · `POST /api/projects`
 * (`API.md` §3.2).
 *
 * Thin adapter only (`AGENTS.md` §4.5): session → parse → module → status map.
 * SET-3 is open to every role through `inventory.read`; SET-4 is Admin through
 * `setup.manage`. Both checks live in the query/command, not here
 * (`AGENTS.md` §5.3).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    const { context } = await requireRequestSession(request);
    const query = parseWith(listProjectsQuerySchema, queryObject(request.url));
    return jsonResponse(
      await listProjects(actorFromContext(context), query),
      requestId,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context } = await requireRequestSession(request);
    const input = await parseJsonBody(request, createProjectSchema);
    const project = await createProject(
      actorFromContext(context),
      input,
      requestMeta(request, requestId),
    );
    return jsonResponse(project, requestId, { status: 201 });
  });
}

export const PATCH = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
