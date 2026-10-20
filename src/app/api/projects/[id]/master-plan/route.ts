import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseJsonBody,
  parseUuid,
  requestMeta,
} from "@/core/http";
import { actorFromContext, requireRequestSession } from "@/modules/identity";
import { replaceProjectMasterPlan } from "@/modules/setup";
import { masterPlanBodySchema } from "@/modules/setup/schemas";

/**
 * SET-7 · `PUT /api/projects/{id}/master-plan` (`API.md` §3.2).
 *
 * The capability is **`inventory.manage`**, not `setup.manage` — `API.md`
 * SET-7's roles line is explicit, and `ARCHITECTURE.md` §6.2 files the master
 * plan under inventory even though `project` is Setup's table. The command
 * performs that check; this adapter only parses and maps the result.
 *
 * The image itself is uploaded first through COR-1 (`POST /api/files`, kind
 * `MASTER_PLAN`); this endpoint binds the resulting `file_object.id`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context: session } = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    const input = await parseJsonBody(request, masterPlanBodySchema);
    const project = await replaceProjectMasterPlan(
      actorFromContext(session),
      id,
      input,
      requestMeta(request, requestId),
    );
    return jsonResponse(project, requestId);
  });
}

export const GET = methodNotAllowed;
export const POST = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
