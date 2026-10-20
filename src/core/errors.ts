/**
 * Stable error codes and their HTTP status — `API.md` §5 (the catalog).
 *
 * Only codes this phase can emit are listed. Adding a code here without a row in
 * `API.md` §5 would be inventing API surface (`AGENTS.md` §6), so the union is
 * deliberately narrow.
 */
export type ApiErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_ACCOUNT_THROTTLED"
  | "AUTH_REQUIRED"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_FORBIDDEN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "PASSWORD_CURRENT_INVALID"
  | "PASSWORD_POLICY_VIOLATION"
  | "CSRF_ORIGIN_REJECTED"
  | "VALIDATION_FAILED"
  | "METHOD_NOT_ALLOWED"
  | "CONFLICT_RETRY"
  | "INTERNAL"
  | "USER_NOT_FOUND"
  | "USER_EMAIL_EXISTS"
  | "USER_SELF_DEACTIVATION"
  | "USER_LAST_ADMIN"
  | "FILE_NOT_FOUND"
  | "FILE_KIND_MISMATCH"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_UNREADABLE"
  | "COMPANY_NOT_CONFIGURED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NAME_EXISTS"
  | "CONFLICT_STALE_WRITE"
  | "MASTER_PLAN_ASPECT_CHANGED"
  | "RATE_LIMITED";

const STATUS: Record<ApiErrorCode, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_ACCOUNT_THROTTLED: 429,
  AUTH_REQUIRED: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  PASSWORD_CURRENT_INVALID: 422,
  PASSWORD_POLICY_VIOLATION: 422,
  CSRF_ORIGIN_REJECTED: 403,
  VALIDATION_FAILED: 400,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT_RETRY: 409,
  INTERNAL: 500,
  USER_NOT_FOUND: 404,
  USER_EMAIL_EXISTS: 409,
  USER_SELF_DEACTIVATION: 409,
  USER_LAST_ADMIN: 409,
  FILE_NOT_FOUND: 404,
  FILE_KIND_MISMATCH: 422,
  FILE_TOO_LARGE: 413,
  FILE_TYPE_UNSUPPORTED: 415,
  FILE_UNREADABLE: 422,
  COMPANY_NOT_CONFIGURED: 404,
  PROJECT_NOT_FOUND: 404,
  PROJECT_NAME_EXISTS: 409,
  CONFLICT_STALE_WRITE: 409,
  MASTER_PLAN_ASPECT_CHANGED: 422,
  RATE_LIMITED: 429,
};

/** English fallbacks. The UI never shows these — it maps `code` to the catalogs (`API.md` §1.4). */
const MESSAGE: Partial<Record<ApiErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: "Invalid email or password.",
  AUTH_ACCOUNT_THROTTLED: "Too many attempts. Try again in a few minutes.",
  AUTH_REQUIRED: "Authentication required.",
  AUTH_SESSION_EXPIRED: "Your session has ended. Please sign in again.",
  AUTH_FORBIDDEN: "You do not have permission to perform this action.",
  PASSWORD_CHANGE_REQUIRED: "You must change your password before continuing.",
  PASSWORD_CURRENT_INVALID: "The current password is incorrect.",
  CSRF_ORIGIN_REJECTED: "Request origin rejected.",
  VALIDATION_FAILED: "The request is invalid.",
  METHOD_NOT_ALLOWED: "Method not allowed.",
  CONFLICT_RETRY: "The request conflicted with another. Please retry.",
  INTERNAL: "An unexpected error occurred.",
  USER_NOT_FOUND: "User not found.",
  USER_EMAIL_EXISTS: "A user with that email already exists.",
  USER_SELF_DEACTIVATION: "You cannot deactivate your own account.",
  USER_LAST_ADMIN: "At least one active Admin must remain.",
  FILE_NOT_FOUND: "File not found.",
  FILE_KIND_MISMATCH: "That file cannot be used here.",
  FILE_TOO_LARGE: "The file is too large.",
  FILE_TYPE_UNSUPPORTED: "That file type is not supported.",
  FILE_UNREADABLE: "The image could not be read.",
  COMPANY_NOT_CONFIGURED: "The company profile is not configured yet.",
  PROJECT_NOT_FOUND: "Project not found.",
  PROJECT_NAME_EXISTS: "A project with that name already exists.",
  CONFLICT_STALE_WRITE: "This record changed since you loaded it.",
  MASTER_PLAN_ASPECT_CHANGED:
    "The new master plan has a different aspect ratio; confirm the change.",
  RATE_LIMITED: "Too many requests. Please slow down.",
};

export type FieldErrors = Record<string, string>;

export interface AppErrorOptions {
  message?: string;
  fields?: FieldErrors;
  retryAfterSeconds?: number;
  cause?: unknown;
  /**
   * `API.md` §1.3 and §5.2: `VALIDATION_FAILED` is the one catalogue code that
   * carries two statuses — `400` when the *shape* is wrong, `422` when a
   * well-formed value breaks a stated domain rule (a `0.00` Marla value, a
   * negative price). Any other code/status pair is a bug, so it throws.
   */
  httpStatus?: 422;
}

/**
 * A business failure with a documented code. Thrown by commands/queries and
 * mapped to the wire envelope by `errorResponse` (`AGENTS.md` §5.2).
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;
  /** Seconds for `Retry-After`; only 429 uses it (`API.md` §1.3). */
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? MESSAGE[code] ?? code, { cause: options.cause });
    if (options.httpStatus !== undefined) {
      if (code !== "VALIDATION_FAILED" || options.httpStatus !== 422) {
        throw new Error(
          `AppError: ${code} cannot be raised with HTTP ${String(options.httpStatus)}`,
        );
      }
    }
    this.name = "AppError";
    this.code = code;
    this.status = options.httpStatus ?? STATUS[code];
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /**
   * `fields` on the wire.
   *
   * `API.md` §1.4 calls `fields` "only for 400/422", but the specific rules
   * contradict it: §1.6 ("Zero rows → `409 CONFLICT_STALE_WRITE`,
   * `fields: { \"version\": \"STALE\" }`"), SET-6/SET-7, the §5.3 catalogue row
   * for that code, and the 409 rows of IDN-4 (`USER_EMAIL_EXISTS`) and SAL-2/
   * SAL-6 (`BUYER_CNIC_EXISTS`) all carry `fields`. Specific over general, so
   * whatever a command attaches is serialised.
   *
   * OPEN-QUESTION: AG-Q26.
   */
  get wireFields(): FieldErrors | undefined {
    return this.fields;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * `422 VALIDATION_FAILED` — the "well-formed but the rule fails" branch of
 * `API.md` §1.3 (`marlaSqft <= 0` at SET-2/SET-4/SET-6 is the Setup example).
 * Kept next to the class so no module re-implements the status override.
 */
export function unprocessable(fields: FieldErrors): AppError {
  return new AppError("VALIDATION_FAILED", { fields, httpStatus: 422 });
}

export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    fields?: FieldErrors;
  };
}

export function errorEnvelope(
  page: Pick<AppError, "code" | "message" | "wireFields">,
  requestId: string,
): ErrorEnvelope {
  const envelope: ErrorEnvelope = {
    error: { code: page.code, message: page.message, requestId },
  };
  if (page.wireFields) envelope.error.fields = page.wireFields;
  return envelope;
}
