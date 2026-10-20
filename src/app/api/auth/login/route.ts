import {
  clientIp,
  errorResponse,
  jsonResponse,
  parseJsonBody,
  requestIdOf,
} from "@/core/http";
import { methodNotAllowed } from "@/core/route";
import { serializeSessionCookie } from "@/core/session";
import { login, type RequestMeta } from "@/modules/identity";
import { loginSchema } from "@/modules/identity/schemas";

/**
 * AUTH-1 · `POST /api/auth/login` (`API.md` §2.4).
 *
 * Public: no session and **no CSRF origin check** — that is explicit in API.md
 * AUTH-1, because the browser sends the login form from the same origin anyway
 * and the endpoint is protected by the two throttle layers instead.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    const input = await parseJsonBody(request, loginSchema);
    const meta: RequestMeta = {
      requestId,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
    };
    const result = await login(input, meta);
    return jsonResponse(result.info, requestId, {
      status: 200,
      headers: {
        // Session cookie: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain
        // (`ARCHITECTURE.md` §6.1). No Max-Age: it dies with the browser.
        "Set-Cookie": serializeSessionCookie(result.token),
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/** Non-POST methods get the documented 405 envelope, never a Next.js default. */
export const GET = methodNotAllowed;
