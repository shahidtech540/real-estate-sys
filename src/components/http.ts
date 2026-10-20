/**
 * Browser-side API helper. It knows only the envelope of `API.md` §1.4: a
 * successful response is JSON (or 204), a failure is `{error:{code,…}}`.
 * UI code never branches on HTTP status — only on the stable `code`.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    status: number,
    message: string,
    fields?: Record<string, string>,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface ErrorEnvelope {
  error: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
}

export async function apiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T | null> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    // Same-origin cookies; the CSRF check is Origin/Host, not a token
    // (`API.md` §1.10).
    credentials: "same-origin",
  });

  if (response.status === 204) return null;

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope;
    const retryAfter = response.headers.get("retry-after");
    throw new ApiClientError(
      envelope.error?.code ?? "INTERNAL",
      response.status,
      envelope.error?.message ?? "request failed",
      envelope.error?.fields,
      retryAfter ? Number(retryAfter) : undefined,
    );
  }

  return payload as T;
}

export function errorCodeOf(error: unknown): string | undefined {
  return error instanceof ApiClientError ? error.code : undefined;
}
