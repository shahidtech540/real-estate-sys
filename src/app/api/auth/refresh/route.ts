import { handleRequest, methodNotAllowed } from "@/core/route";
import { assertSameOrigin, jsonResponse } from "@/core/http";
import { refresh, requireRequestSession } from "@/modules/identity";

/**
 * AUTH-4 · `POST /api/auth/refresh` (`API.md` §2.4).
 *
 * Slides the idle window to `LEAST(now + 30m, absolute_expires_at)` and never
 * mints a new token (`API.md` §2.1).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context } = await requireRequestSession(request, {
      allowWhenPasswordChangeRequired: true,
    });
    return jsonResponse(await refresh(context), requestId);
  });
}

export const GET = methodNotAllowed;
