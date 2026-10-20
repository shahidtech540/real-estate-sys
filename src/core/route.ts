import { AppError, isAppError } from "./errors";
import { errorResponse, requestIdOf } from "./http";
import { logger } from "./logging";

/**
 * The thin adapter wrapper of `ARCHITECTURE.md` §3.2: parse → authorize → call
 * the module → map result/errors. It exists so every handler gets the same
 * `X-Request-Id`, the same envelope and the same `500` behaviour (`API.md` §1.4).
 */
export async function handleRequest(
  request: Request,
  fn: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    return await fn(requestId);
  } catch (error) {
    if (error instanceof AppError) {
      // Expected business failure: one line, no stack, no PII (`ARCHITECTURE.md` §14.8).
      logger.warn({ requestId, code: error.code }, error.message);
    } else {
      logger.error({ requestId, err: error }, "unhandled error");
    }
    return errorResponse(error, requestId);
  }
}

/**
 * Only `POST`/`PATCH`/`DELETE` mutate; `GET` never does (`ARCHITECTURE.md` §6.3).
 * Every route exports this for the methods it does not implement so a wrong verb
 * gets the documented envelope instead of a framework default.
 */
export function methodNotAllowed(request: Request): Response {
  return errorResponse(
    new AppError("METHOD_NOT_ALLOWED"),
    requestIdOf(request),
  );
}

export { isAppError };
