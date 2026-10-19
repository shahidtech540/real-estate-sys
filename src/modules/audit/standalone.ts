import { logger } from "@/core/logging";
import { db } from "@/core/db";
import type { AuditEntryInput } from "./record";
import { buildAuditRow } from "./record";

/**
 * The single exception to "audit inside the business transaction":
 * **login failures**, which happen before any session or transaction exists
 * (`ARCHITECTURE.md` §13.6, `API.md` §2.2).
 *
 * A failure to write here is logged and swallowed. The caller still returns the
 * generic credentials error, so the response never reveals whether the audit
 * write succeeded (`ARCHITECTURE.md` §13.6).
 *
 * No other module may use this function. It exists only for
 * `identity.login`, and the action it writes is always `auth.login_failed`.
 */
export async function recordLoginFailure(
  entry: Omit<AuditEntryInput, "action" | "actor">,
): Promise<void> {
  try {
    const row = buildAuditRow({
      ...entry,
      action: "auth.login_failed",
      entityType: "session",
      actor: null,
    });
    await db().auditLog.create({ data: row });
  } catch (error) {
    logger.error({ err: error }, "audit write failed for auth.login_failed");
  }
}
