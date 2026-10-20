import { handleRequest, methodNotAllowed } from "@/core/route";
import {
  assertSameOrigin,
  jsonResponse,
  parseJsonBody,
  requestMeta,
} from "@/core/http";
import { actorFromContext, requireRequestSession } from "@/modules/identity";
import { companyBodySchema } from "@/modules/setup/schemas";
import { getCompany, putCompany } from "@/modules/setup";

/**
 * SET-1 · `GET /api/company` and SET-2 · `PUT /api/company` (`API.md` §3.2).
 *
 * Thin adapter only (`AGENTS.md` §4.5): session → parse → module → status map.
 * GET is session-only (`API.md` §8.3); PUT is Admin through `setup.manage`,
 * checked inside the command.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    // Any authenticated role may read the company (API.md SET-1 roles line).
    await requireRequestSession(request);
    return jsonResponse(await getCompany(), requestId);
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context } = await requireRequestSession(request);
    const input = await parseJsonBody(request, companyBodySchema);
    const result = await putCompany(
      actorFromContext(context),
      input,
      requestMeta(request, requestId),
    );
    return jsonResponse(result.company, requestId, {
      // 201 on the first run, 200 on every later full replace (API.md §1.3, SET-2).
      status: result.created ? 201 : 200,
      headers: result.created ? { Location: "/api/company" } : {},
    });
  });
}

export const POST = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
