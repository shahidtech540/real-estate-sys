import type { Tx } from "@/core/db";
import type { AuditActionCode } from "./action-codes";
import { isAuditActionCode } from "./action-codes";

/**
 * The one and only audit write path — `ARCHITECTURE.md` §13.1, §13.3.
 *
 * Rules this file enforces:
 * 1. **Append-only.** There is no update or delete function, and the only
 *    Prisma call made is `auditLog.create` (`ARCHITECTURE.md` §13.3).
 * 2. **Same transaction.** `record()` takes the caller's `Tx`; it never opens its
 *    own (`AGENTS.md` §5.7). A rollback removes the business change and its log
 *    row together.
 * 3. **No PII in `summary`.** `assertSummaryIsSafe` rejects CNIC, phone, address
 *    and path keys before the insert (`ARCHITECTURE.md` §13.2, §15.2).
 * 4. **Stable codes only.** An unknown code throws; `ck_audit_log_action_code`
 *    would reject it anyway (`DATABASE.md` §3.10).
 */

/** The subset of the Prisma client this helper needs; keeps the helper testable. */
export interface AuditCreateArgs {
  data: {
    actionCode: string;
    entityType: string;
    entityId: string | null;
    bookingId: string | null;
    actorUserId: string | null;
    actorLabel: string;
    summary: Record<string, unknown>;
    requestId: string | null;
    ip: string | null;
    occurredAt?: Date;
  };
}

export interface AuditTx {
  auditLog: {
    create(args: AuditCreateArgs): Promise<unknown>;
  };
}

export interface AuditActor {
  id: string;
  /** Denormalized name/email at event time (`DATABASE.md` §3.10). */
  label: string;
}

export interface AuditEntryInput {
  action: AuditActionCode;
  entityType: string;
  entityId?: string | null;
  bookingId?: string | null;
  summary?: Record<string, unknown>;
  /** `null` is a system action: `actor_label` becomes `system`. */
  actor: AuditActor | null;
  requestId?: string | null;
  ip?: string | null;
  occurredAt?: Date;
}

export interface AuditRowData {
  actorUserId: string | null;
  actorLabel: string;
  actionCode: AuditActionCode;
  entityType: string;
  entityId: string | null;
  bookingId: string | null;
  summary: Record<string, unknown>;
  requestId: string | null;
  ip: string | null;
  occurredAt?: Date;
}

/** Keys that must never appear in `summary` (`ARCHITECTURE.md` §13.2). */
const FORBIDDEN_SUMMARY_KEY =
  /(cnic|phone|mobile|address|path|filename|token|password|secret)/i;

function collectUnsafeKeys(value: unknown, found: string[], prefix = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) collectUnsafeKeys(item, found, prefix);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const path = prefix ? `${prefix}.${key}` : key;
    // `fields: ['cnic']` is the documented way to name a sensitive field; the
    // key `fields` is safe, a key *named* `cnic` is not.
    if (FORBIDDEN_SUMMARY_KEY.test(key)) found.push(path);
    collectUnsafeKeys(nested, found, path);
  }
}

export function unsafeSummaryKeys(summary: Record<string, unknown>): string[] {
  const found: string[] = [];
  collectUnsafeKeys(summary, found);
  return found;
}

function assertSummaryIsSafe(summary: Record<string, unknown>): void {
  const unsafe = unsafeSummaryKeys(summary);
  if (unsafe.length > 0) {
    throw new Error(
      `audit summary contains sensitive keys: ${unsafe.join(", ")}`,
    );
  }
}

/**
 * Builds the exact row payload. Exported so a unit test can assert the shape
 * without a database, and so no other module hand-writes an audit row.
 */
export function buildAuditRow(entry: AuditEntryInput): AuditRowData {
  if (!isAuditActionCode(entry.action)) {
    throw new Error(`unknown audit action code: ${String(entry.action)}`);
  }
  const summary = entry.summary ?? {};
  assertSummaryIsSafe(summary);
  const row: AuditRowData = {
    actorUserId: entry.actor?.id ?? null,
    actorLabel: entry.actor?.label ?? "system",
    actionCode: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    bookingId: entry.bookingId ?? null,
    summary,
    requestId: entry.requestId ?? null,
    ip: entry.ip ?? null,
  };
  if (entry.occurredAt) row.occurredAt = entry.occurredAt;
  return row;
}

/**
 * Writes one audit row inside the caller's transaction. An audit failure fails
 * the command — there is no best-effort mode (`ARCHITECTURE.md` §13.6).
 */
export async function record(tx: Tx, entry: AuditEntryInput): Promise<void> {
  // One structural cast: the generated client is `Tx`-shaped, but Phase 1 also
  // type-checks against the un-generated stub (see PR "Tooling note").
  await (tx as unknown as AuditTx).auditLog.create({
    data: buildAuditRow(entry),
  });
}
