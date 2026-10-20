import { AppError } from "../errors";

/**
 * The capability matrix — `ARCHITECTURE.md` §6.2, verbatim (24 capabilities,
 * three roles). This table is the only source of truth for permissions; UI
 * navigation is derived from it so it cannot drift (`ARCHITECTURE.md` §6.3).
 */
export const CAPABILITIES = [
  "setup.manage",
  "inventory.manage",
  "inventory.read",
  "inventory.status",
  "booking.create",
  "booking.manage",
  "booking.cancel",
  "booking.note",
  "buyer.read",
  "buyer.edit",
  "buyer.consent",
  "sales.read",
  "ledger.read",
  "payment.record",
  "payment.void",
  "cashbook.record",
  "cashbook.categories",
  "recovery.read",
  "reminder.read",
  "reminder.configure",
  "report.read",
  "document.download",
  "user.manage",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type Role = "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";

/** Row order follows `ARCHITECTURE.md` §6.2: Admin, Sales Agent, Accountant. */
const POLICY: Record<Capability, readonly Role[]> = {
  "setup.manage": ["ADMIN"],
  "inventory.manage": ["ADMIN"],
  "inventory.read": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "inventory.status": ["ADMIN"],
  "booking.create": ["ADMIN", "SALES_AGENT"],
  "booking.manage": ["ADMIN"],
  "booking.cancel": ["ADMIN"],
  "booking.note": ["ADMIN", "SALES_AGENT"],
  "buyer.read": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "buyer.edit": ["ADMIN", "SALES_AGENT"],
  "buyer.consent": ["ADMIN", "ACCOUNTANT"],
  "sales.read": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "ledger.read": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "payment.record": ["ADMIN", "ACCOUNTANT"],
  "payment.void": ["ADMIN", "ACCOUNTANT"],
  "cashbook.record": ["ADMIN", "ACCOUNTANT"],
  "cashbook.categories": ["ADMIN"],
  "recovery.read": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "reminder.read": ["ADMIN", "ACCOUNTANT"],
  "reminder.configure": ["ADMIN"],
  "report.read": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "document.download": ["ADMIN", "SALES_AGENT", "ACCOUNTANT"],
  "user.manage": ["ADMIN"],
  "audit.read": ["ADMIN"],
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return POLICY[capability].includes(role);
}

/** The `capabilities` array of `SessionInfo` / `IDN-1` (`API.md` §1.9). */
export function capabilitiesFor(role: Role): Capability[] {
  return CAPABILITIES.filter((capability) => hasCapability(role, capability));
}

/**
 * Throws `403 AUTH_FORBIDDEN` before any row lookup (`ARCHITECTURE.md` §6.3).
 * Every command/query calls this inside the function — a route handler is never
 * the only check (`AGENTS.md` §5.3).
 */
export function requireCapability(
  actor: { role: Role },
  capability: Capability,
): void {
  if (!hasCapability(actor.role, capability)) {
    throw new AppError("AUTH_FORBIDDEN");
  }
}
