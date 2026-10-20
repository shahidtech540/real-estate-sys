import { NextResponse } from "next/server";
import { db } from "@/core/db";
import { BASE_HEADERS, requestIdOf } from "@/core/http";

// `version` in the COR-3 payload identifies the deployed build. It is taken from
// package.json so no extra environment key is invented (AGENTS.md AG-Q4).
import pkg from "../../../../package.json";

/**
 * COR-3 — `GET /api/health` (`API.md` §3.12).
 *
 * Public, minimal on purpose: no schema, counts or secrets
 * (`ARCHITECTURE.md` §10.11). `200` only when the process is up **and** the
 * database answers; `503` when the database ping fails. The body of a `503` is
 * deliberately not a data shape — it says nothing about the failure.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  try {
    await db().$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", version: pkg.version },
      { status: 200, headers: { ...BASE_HEADERS, "X-Request-Id": requestId } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", version: pkg.version },
      { status: 503, headers: { ...BASE_HEADERS, "X-Request-Id": requestId } },
    );
  }
}
