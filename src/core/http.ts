import { randomUUID } from "node:crypto";
import { z, ZodError, type ZodTypeAny } from "zod";
import {
  AppError,
  errorEnvelope,
  isAppError,
  type FieldErrors,
} from "./errors";
import { safeEqual } from "./session";

/**
 * Transport helpers shared by every route handler — `API.md` §1.1, §1.4, §1.10
 * and `ARCHITECTURE.md` §14.8.
 */

export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

/** Incoming `X-Request-Id` or a new one; echoed on every response (`API.md` §1.1). */
export function requestIdOf(request: Request): string {
  const incoming = request.headers.get("x-request-id");
  return incoming && incoming.length <= 200 ? incoming : randomUUID();
}

/** `ip` columns are `varchar(45)` (`DATABASE.md` §3.1); null when unknown. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const raw = forwarded?.split(",")[0]?.trim() ?? null;
  if (!raw) return null;
  return raw.length <= 45 ? raw : null;
}

/** `user_agent` is truncated to 512 chars by the service (`DATABASE.md` §3.1). */
export function userAgentOf(request: Request): string | null {
  const value = request.headers.get("user-agent");
  return value ? value.slice(0, 512) : null;
}

/** Audit/session metadata for one request; no cookie, no body, no PII. */
export function requestMeta(
  request: Request,
  requestId: string,
): { requestId: string; ip: string | null; userAgent: string | null } {
  return { requestId, ip: clientIp(request), userAgent: userAgentOf(request) };
}

/**
 * CSRF defence: `Origin` must match `Host` on every non-GET request
 * (`API.md` §1.10, `ARCHITECTURE.md` §6.4). No token, no CORS.
 * A missing `Origin` is rejected: browsers send it for same-origin POSTs.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("CSRF_ORIGIN_REJECTED");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("CSRF_ORIGIN_REJECTED");
  }
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || originHost !== host) throw new AppError("CSRF_ORIGIN_REJECTED");
}

export interface JsonOptions {
  status?: number;
  headers?: Record<string, string>;
}

export function jsonResponse(
  data: unknown,
  requestId: string,
  options: JsonOptions = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: options.status ?? 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": requestId,
      ...options.headers,
    },
  });
}

export function emptyResponse(
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, {
    status,
    headers: { ...BASE_HEADERS, "X-Request-Id": requestId, ...headers },
  });
}

/** Maps any thrown value to the one envelope of `API.md` §1.4. */
export function errorResponse(error: unknown, requestId: string): Response {
  const appError = isAppError(error)
    ? error
    : new AppError("INTERNAL", { cause: error });
  if (!isAppError(error)) {
    // Structured log with the request id; the response never carries the detail.
    console.error(
      JSON.stringify({ level: "error", requestId, message: String(error) }),
    );
  }
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "X-Request-Id": requestId,
  };
  if (appError.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(appError.retryAfterSeconds);
  }
  return new Response(JSON.stringify(errorEnvelope(appError, requestId)), {
    status: appError.status,
    headers,
  });
}

const FIELD_CODES: Record<string, string> = {
  invalid_type: "REQUIRED",
  invalid_string: "FORMAT",
  invalid_enum_value: "FORMAT",
  too_small: "TOO_SHORT",
  too_big: "TOO_LONG",
  unrecognized_keys: "UNKNOWN",
  custom: "INVALID",
};

function fieldsFromZod(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    fields[path] = FIELD_CODES[issue.code] ?? "INVALID";
  }
  return fields;
}

/** Parses a JSON body through a Zod schema; every failure is `400 VALIDATION_FAILED`. */
export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", {
      fields: { body: "INVALID_JSON" },
    });
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: fieldsFromZod(result.error),
    });
  }
  // `safeParse` has already narrowed `success` to true.
  return result.data as z.output<S>;
}

/** Path UUIDs: a malformed id is `400 VALIDATION_FAILED` with `fields.<name>=FORMAT`. */
export function parseUuid(value: string, field = "id"): string {
  const parsed = userIdLike.safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { fields: { [field]: "FORMAT" } });
  }
  return parsed.data;
}

const userIdLike = z.string().uuid();

/** Query-string object for `parseWith(schema, …)`; repeated keys become arrays. */
export function queryObject(url: string): Record<string, string | string[]> {
  const params = new URL(url).searchParams;
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/**
 * Bearer-token comparison for COR-4 (`API.md` §3.12). The token is a machine
 * credential, never a session; a mismatch is `401 AUTH_REQUIRED`.
 */
export function assertMachineToken(
  request: Request,
  expected: string | undefined,
): void {
  if (!expected) throw new AppError("AUTH_REQUIRED");
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new AppError("AUTH_REQUIRED");
  const presented = header.slice("Bearer ".length).trim();
  if (!safeEqual(presented, expected)) throw new AppError("AUTH_REQUIRED");
}
