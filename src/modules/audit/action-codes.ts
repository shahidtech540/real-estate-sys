/**
 * The frozen `action_code` registry — `AGENTS.md` §5.12, `ARCHITECTURE.md` §13.2.
 *
 * Phase 1 only needs the names `API.md` §2.2 / §3.1 already fix. Nothing is
 * added here that a document does not name: a code that is not in this file is a
 * bug, not a naming choice. (Later phases extend the registry exactly as
 * `AGENTS.md` §5.12 describes.)
 */
export const AUDIT_ACTION_CODES = {
  authLogin: "auth.login",
  authLoginFailed: "auth.login_failed",
  authLogout: "auth.logout",
  authPasswordChanged: "auth.password_changed",
  userCreated: "user.created",
  userUpdated: "user.updated",
  userRoleChanged: "user.role_changed",
  userDeactivated: "user.deactivated",
  userPasswordReset: "user.password_reset",
  userUnlocked: "user.unlocked",
  // Named verbatim by `API.md` SET-2 ("audit_log company.created / company.updated").
  companyCreated: "company.created",
  companyUpdated: "company.updated",
  // Named verbatim by `API.md` SET-4, SET-6 and SET-7.
  projectCreated: "project.created",
  projectUpdated: "project.updated",
  projectMasterPlanReplaced: "project.master_plan_replaced",
} as const;

export type AuditActionCode =
  (typeof AUDIT_ACTION_CODES)[keyof typeof AUDIT_ACTION_CODES];

const CODE_SET: ReadonlySet<string> = new Set(
  Object.values(AUDIT_ACTION_CODES),
);

/**
 * Guards the `ck_audit_log_action_code` shape (`DATABASE.md` §3.10) before the
 * insert, so a typo fails in the application with a clear message instead of as a
 * generic constraint violation inside a business transaction.
 */
export function isAuditActionCode(value: string): value is AuditActionCode {
  return CODE_SET.has(value);
}
