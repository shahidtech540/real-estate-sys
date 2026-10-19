import { handleRequest, methodNotAllowed } from "@/core/route";
import { jsonResponse } from "@/core/http";
import { me, requireRequestSession } from "@/modules/identity";

/** IDN-1 · `GET /api/me` (`API.md` §3.1). Any authenticated session. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    const { context } = await requireRequestSession(request);
    return jsonResponse(me(context), requestId);
  });
}

export const POST = methodNotAllowed;
