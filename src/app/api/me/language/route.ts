import { handleRequest, methodNotAllowed } from "@/core/route";
import { assertSameOrigin, jsonResponse, parseJsonBody } from "@/core/http";
import {
  actorFromContext,
  requireRequestSession,
  setLanguage,
} from "@/modules/identity";
import { languageSchema } from "@/modules/identity/schemas";

/**
 * IDN-2 · `PATCH /api/me/language` (`API.md` §3.1).
 *
 * Persists a UI preference; no audit row by design (`ARCHITECTURE.md` §13.1 —
 * a preference is not a sensitive action).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const { context } = await requireRequestSession(request);
    const input = await parseJsonBody(request, languageSchema);
    return jsonResponse(
      await setLanguage(actorFromContext(context), input),
      requestId,
    );
  });
}

export const GET = methodNotAllowed;
