import { handleRequest, methodNotAllowed } from "@/core/route";
import { assertMachineToken, jsonResponse } from "@/core/http";
import { env } from "@/core/config";
import { db } from "@/core/db";

/**
 * COR-4 · `GET /api/health/details` (`API.md` §3.12).
 *
 * Machine token only — never a session cookie, never usable by staff. The
 * backup heartbeat is written by the backup script outside the database, so
 * `lastBackupHeartbeat` is `null` until that marker is wired (§14.8); returning
 * a value here would be a claim nothing checks.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async (requestId) => {
    assertMachineToken(request, env().HEALTH_DETAILS_TOKEN);
    const client = db();
    const [lastTickRow, running] = await Promise.all([
      client.jobRun.findFirst({
        where: { jobName: "reminders.tick" },
        orderBy: { startedAt: "desc" },
      }),
      client.jobRun.findMany({
        where: { status: "RUNNING" },
        orderBy: { startedAt: "asc" },
        select: { jobName: true, startedAt: true },
      }),
    ]);
    const lastTick = lastTickRow as { startedAt: Date; status: string } | null;

    return jsonResponse(
      {
        // Degraded only on a failed tick; staleness alerting lives in the
        // external monitor, which knows the 09:00–20:00 PKT window (§14.8).
        status: lastTick?.status === "FAILED" ? "degraded" : "ok",
        lastReminderTick: lastTick
          ? {
              startedAt: lastTick.startedAt.toISOString(),
              status: lastTick.status,
            }
          : null,
        lastBackupHeartbeat: null,
        runningJobs: running.map((row) => {
          const job = row as { jobName: string; startedAt: Date };
          return {
            jobName: job.jobName,
            startedAt: job.startedAt.toISOString(),
          };
        }),
        database: "ok",
      },
      requestId,
    );
  });
}

export const POST = methodNotAllowed;
