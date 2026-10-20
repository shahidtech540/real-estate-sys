import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/core/db";
import {
  buildAuditRow,
  record,
  unsafeSummaryKeys,
} from "@/modules/audit/record";
import {
  AUDIT_ACTION_CODES,
  isAuditActionCode,
} from "@/modules/audit/action-codes";

/**
 * The audit write helper — `ARCHITECTURE.md` §13.1–§13.3, §13.6.
 *
 * The helper must write exactly one row, in the caller's transaction, with a
 * frozen action code and a summary that carries no PII.
 */
describe("buildAuditRow", () => {
  it("writes the actor label at event time and defaults the system actor", () => {
    expect(
      buildAuditRow({
        action: "auth.login",
        entityType: "session",
        entityId: "11111111-1111-4111-8111-111111111111",
        actor: {
          id: "22222222-2222-4222-8222-222222222222",
          label: "Ayesha Khan",
        },
        requestId: "req-1",
        ip: "203.0.113.7",
        summary: {},
      }),
    ).toEqual({
      actorUserId: "22222222-2222-4222-8222-222222222222",
      actorLabel: "Ayesha Khan",
      actionCode: "auth.login",
      entityType: "session",
      entityId: "11111111-1111-4111-8111-111111111111",
      bookingId: null,
      summary: {},
      requestId: "req-1",
      ip: "203.0.113.7",
    });

    expect(
      buildAuditRow({
        action: "auth.login_failed",
        entityType: "session",
        actor: null,
      }).actorLabel,
    ).toBe("system");
  });

  it("rejects an action code that is not in the frozen registry", () => {
    expect(() =>
      buildAuditRow({
        // @ts-expect-error — a typo must not compile, and must not run either.
        action: "auth.signed_in",
        entityType: "session",
        actor: null,
      }),
    ).toThrow(/unknown audit action code/);
  });

  it("does not accept CNIC, phone, address or paths in the summary", () => {
    for (const summary of [
      { cnic: "35202-1234567-1" },
      { phone: "+923001234567" },
      { address: "House 1" },
      { nested: { filePath: "/srv/spm/files/x" } },
    ]) {
      expect(unsafeSummaryKeys(summary)).not.toHaveLength(0);
      expect(() =>
        buildAuditRow({
          action: "user.updated",
          entityType: "user",
          actor: null,
          summary,
        }),
      ).toThrow(/sensitive keys/);
    }
  });

  it("allows the documented `fields` list, even when it names cnic", () => {
    expect(() =>
      buildAuditRow({
        action: "user.updated",
        entityType: "user",
        actor: null,
        summary: { fields: ["name"] },
      }),
    ).not.toThrow();
  });
});

describe("record", () => {
  it("performs exactly one create and never an update or delete", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1n });
    const fake = {
      auditLog: { create },
      // Any mutation path would be a contract violation; assert it is untouched.
      update: vi.fn(),
      delete: vi.fn(),
    };
    const tx = fake as unknown as Tx;

    await record(tx, {
      action: "user.created",
      entityType: "user",
      actor: { id: "22222222-2222-4222-8222-222222222222", label: "Admin" },
      summary: { role: "SALES_AGENT" },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [args] = create.mock.calls[0] as [
      { data: { actionCode: string; summary: unknown } },
    ];
    expect(args.data.actionCode).toBe("user.created");
    expect(args.data.summary).toEqual({ role: "SALES_AGENT" });
    expect(fake.update).not.toHaveBeenCalled();
    expect(fake.delete).not.toHaveBeenCalled();
  });

  it("exposes only the phase-1 action codes", () => {
    expect(Object.values(AUDIT_ACTION_CODES).sort()).toEqual([
      "auth.login",
      "auth.login_failed",
      "auth.logout",
      "auth.password_changed",
      "user.created",
      "user.deactivated",
      "user.password_reset",
      "user.role_changed",
      "user.unlocked",
      "user.updated",
    ]);
    expect(isAuditActionCode("booking.created")).toBe(false);
  });
});
