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
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_UNREADABLE"
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
  FILE_TOO_LARGE: 413,
  FILE_TYPE_UNSUPPORTED: 415,
  FILE_UNREADABLE: 422,
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
  FILE_TOO_LARGE: "The file is too large.",
  FILE_TYPE_UNSUPPORTED: "That file type is not supported.",
  FILE_UNREADABLE: "The image could not be read.",
  RATE_LIMITED: "Too many requests. Please slow down.",
};

export type FieldErrors = Record<string, string>;

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

  constructor(
    code: ApiErrorCode,
    options: {
      message?: string;
      fields?: FieldErrors;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGE[code] ?? code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** `fields` is only allowed on 400/422 (`API.md` §1.4). */
  get wireFields(): FieldErrors | undefined {
    return this.status === 400 || this.status === 422 ? this.fields : undefined;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
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
