import { Readable } from "node:stream";
import {
  BASE_HEADERS,
  errorResponse,
  parseUuid,
  requestIdOf,
} from "@/core/http";
import { AppError } from "@/core/errors";
import { requireRequestSession, actorFromContext } from "@/modules/identity";
import { openFile } from "@/modules/core/files";

/**
 * COR-2 · `GET /api/files/{id}` (`API.md` §3.12).
 *
 * Files are private: the id is resolved to a storage key only after the kind's
 * read capability check, and the key never appears in the response
 * (`ARCHITECTURE.md` §7.4).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIANTS = ["original", "display", "thumb", "avatar"] as const;
type Variant = (typeof VARIANTS)[number];

function parseVariant(value: string | null): Variant {
  if (value === null) return "original";
  if ((VARIANTS as readonly string[]).includes(value)) return value as Variant;
  throw new AppError("VALIDATION_FAILED", { fields: { variant: "FORMAT" } });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    const session = await requireRequestSession(request);
    const id = parseUuid((await context.params).id);
    const variant = parseVariant(
      new URL(request.url).searchParams.get("variant"),
    );
    const served = await openFile(
      actorFromContext(session.context),
      id,
      variant,
    );
    const etag = `"${served.etag}"`;

    // 304 keeps a plan image cheap to re-open (`API.md` COR-2).
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ...BASE_HEADERS, ETag: etag, "X-Request-Id": requestId },
      });
    }

    return new Response(Readable.toWeb(served.stream) as ReadableStream, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": served.contentType,
        ...(served.byteSize !== null
          ? { "Content-Length": String(served.byteSize) }
          : {}),
        ETag: etag,
        "Content-Disposition": "inline",
        // Private and short-lived; never public (`ARCHITECTURE.md` §7.4).
        "Cache-Control": "private, max-age=3600",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
