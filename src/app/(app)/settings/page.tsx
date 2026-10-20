import { redirect } from "next/navigation";
import { NotAvailable } from "@/components/not-available";
import { hasCapability } from "@/core/authz/policy";
import { isAppError } from "@/core/errors";
import { actorFromContext, getPageSession } from "@/modules/identity";
import {
  getCompany,
  listProjects,
  type CompanyDto,
  type ProjectDto,
} from "@/modules/setup";
import { SettingsView } from "./settings-view";
import { ProjectsPanel } from "./projects-panel";

/**
 * Settings screen (#14) — `IMPLEMENTATION-PLAN.md` §2.4 (`PRD.md` §11 #14,
 * `DESIGN.md` §13.14). This PR adds the **projects** portion next to the
 * company profile from the previous PR.
 *
 * Admin only (`setup.manage`, `ARCHITECTURE.md` §6.2); another role deep-linking
 * gets the §6 empty state. The company's first run is a **documented empty
 * state**, not an error: SET-1 answers `404 COMPANY_NOT_CONFIGURED` until the
 * singleton exists (`API.md` §3.2, PRD §12). Projects are only listed once the
 * company exists, because SET-4 requires it and SET-3 is company-scoped.
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

  // `null` company = first run; there cannot be a project without a company
  // (`DATABASE.md` §3.2, FK `company_id → company.id ON DELETE RESTRICT`).
  let projects: ProjectDto[] = [];
  let projectTotal = 0;
  if (company) {
    const page = await listProjects(actorFromContext(session), {
      page: 1,
      pageSize: 50,
      sort: "name",
      order: "asc",
    });
    projects = page.data;
    projectTotal = page.total;
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <SettingsView initialCompany={company} />
      {company ? (
        <ProjectsPanel
          initialProjects={projects}
          initialTotal={projectTotal}
          companyMarlaSqft={company.marlaSqft}
        />
      ) : null}
    </div>
  );
}
