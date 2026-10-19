import { handleRequest, methodNotAllowed } from "@/core/route";
import { assertSameOrigin, jsonResponse, requestMeta } from "@/core/http";
import { AppError } from "@/core/errors";
import { checkRateLimit } from "@/core/rate-limit";
import { isFileKind } from "@/core/files/upload";
import { actorFromContext, requireRequestSession } from "@/modules/identity";
import { uploadFile } from "@/modules/core/files";

/**
 * COR-1 · `POST /api/files` (`API.md` §3.12).
 *
 * The per-user limit is 10 uploads per minute (`API.md` §6). Nginx caps the body
 * at 26 MB; this handler never trusts `Content-Length` and re-checks the actual
 * byte length per kind (`ARCHITECTURE.md` §7.3 step 2).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertSameOrigin(request);
    const session = await requireRequestSession(request);
    const actor = actorFromContext(session.context);

    const limit = checkRateLimit(`files:upload:${actor.id}`, 10, 60_000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("VALIDATION_FAILED", {
        fields: { body: "INVALID_MULTIPART" },
      });
    }

    const kind = form.get("kind");
    const file = form.get("file");
    if (typeof kind !== "string" || !isFileKind(kind)) {
      throw new AppError("VALIDATION_FAILED", { fields: { kind: "REQUIRED" } });
    }
    if (!(file instanceof File)) {
      throw new AppError("VALIDATION_FAILED", { fields: { file: "REQUIRED" } });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile(
      actor,
      kind,
      bytes,
      file.name,
      requestMeta(request, requestId),
    );
    // 201 for a new object, 200 when identical bytes already exist for this kind.
    return jsonResponse(result.file, requestId, {
      status: result.created ? 201 : 200,
    });
  });
}

export const GET = methodNotAllowed;
