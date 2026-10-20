import { redirect } from "next/navigation";
import { NotAvailable } from "@/components/not-available";
import { hasCapability } from "@/core/authz/policy";
import { isAppError } from "@/core/errors";
import { getPageSession } from "@/modules/identity";
import { getCompany, type CompanyDto } from "@/modules/setup";
import { SettingsView } from "./settings-view";

/**
 * Settings screen (#14) — the company portion of `IMPLEMENTATION-PLAN.md` §2.4
 * (`PRD.md` §11 #14, `DESIGN.md` §13.14). Admin only (`setup.manage`,
 * `ARCHITECTURE.md` §6.2); another role deep-linking gets the §6 empty state.
 *
 * The first run is a **documented empty state**, not an error: SET-1 answers
 * `404 COMPANY_NOT_CONFIGURED` until the singleton exists (`API.md` §3.2,
 * PRD §12). The row is loaded on the server so the form has no loading flash;
 * the client re-reads it through the same API after a save.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getPageSession();
  if (!session) redirect("/login");
  if (!hasCapability(session.user.role, "setup.manage")) {
    return <NotAvailable />;
  }

  let company: CompanyDto | null = null;
  try {
    company = await getCompany();
  } catch (error) {
    if (!(isAppError(error) && error.code === "COMPANY_NOT_CONFIGURED")) {
      throw error;
    }
  }

  return <SettingsView initialCompany={company} />;
}
