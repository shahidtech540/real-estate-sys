import { NextResponse } from "next/server";

// `version` in the COR-3 payload identifies the deployed build. It is taken from
// package.json so no extra environment key is invented (AGENTS.md AG-Q4).
import pkg from "../../../../package.json";

/**
 * API.md COR-3 — `GET /api/health`.
 *
 * Public, minimal on purpose: no schema, counts or secrets (`API.md` §3.12,
 * `ARCHITECTURE.md` §10.11). Returns 503 only when the process is up but the
 * database ping fails.
 *
 * The database ping is added with `core/db` in Phase 1
 * (IMPLEMENTATION-PLAN.md §1.2). Until then the route reports process health
 * only — it never claims a database it has not checked.
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(
    { status: "ok", version: pkg.version },
    { status: 200 },
  );
}
