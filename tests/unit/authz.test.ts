import { describe, expect, it } from "vitest";
import { AppError } from "@/core/errors";
import {
  CAPABILITIES,
  capabilitiesFor,
  hasCapability,
  requireCapability,
  type Role,
} from "@/core/authz/policy";

/**
 * The capability matrix is `ARCHITECTURE.md` §6.2 verbatim. This test is the
 * parameterized role × capability check AGENTS.md §5.3 requires for every new
 * command; it fails if a row is added or edited without both documents.
 */
const SALES_AGENT: string[] = [
  "inventory.read",
  "booking.create",
  "booking.note",
  "buyer.read",
  "buyer.edit",
  "sales.read",
  "ledger.read",
  "recovery.read",
  "report.read",
  "document.download",
];

const ACCOUNTANT: string[] = [
  "inventory.read",
  "buyer.read",
  "buyer.consent",
  "sales.read",
  "ledger.read",
  "payment.record",
  "payment.void",
  "cashbook.record",
  "recovery.read",
  "reminder.read",
  "report.read",
  "document.download",
];

const ROLES: Role[] = ["ADMIN", "SALES_AGENT", "ACCOUNTANT"];

describe("capability matrix (ARCHITECTURE §6.2)", () => {
  it("defines exactly 24 capabilities", () => {
    expect(CAPABILITIES).toHaveLength(24);
  });

  it("grants every capability to Admin", () => {
    expect(capabilitiesFor("ADMIN")).toEqual([...CAPABILITIES]);
  });

  it("grants exactly the Sales Agent column", () => {
    expect(capabilitiesFor("SALES_AGENT").sort()).toEqual(
      [...SALES_AGENT].sort(),
    );
  });

  it("grants exactly the Accountant column", () => {
    expect(capabilitiesFor("ACCOUNTANT").sort()).toEqual(
      [...ACCOUNTANT].sort(),
    );
  });

  it("is a closed matrix: every role × capability pair matches the table", () => {
    for (const role of ROLES) {
      for (const capability of CAPABILITIES) {
        const expected =
          role === "ADMIN" ||
          (role === "SALES_AGENT" && SALES_AGENT.includes(capability)) ||
          (role === "ACCOUNTANT" && ACCOUNTANT.includes(capability));
        expect(hasCapability(role, capability)).toBe(expected);
      }
    }
  });
});

describe("requireCapability", () => {
  it("throws 403 AUTH_FORBIDDEN without leaking anything else", () => {
    try {
      requireCapability({ role: "SALES_AGENT" }, "user.manage");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("AUTH_FORBIDDEN");
      expect((error as AppError).status).toBe(403);
    }
  });

  it("allows Admin to manage users", () => {
    expect(() =>
      requireCapability({ role: "ADMIN" }, "user.manage"),
    ).not.toThrow();
  });
});
