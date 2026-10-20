import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { requireCapability } from "@/core/authz/policy";
import type { Actor, PageDto } from "@/modules/identity";
import type { CompanyDto, ProjectDto } from "./dto";
import { toCompanyDto, toProjectDto } from "./dto";
import * as repo from "./repository";
import type { ListProjectsQuery } from "./schemas";

/**
 * `GET /api/company` — `API.md` §3.2 SET-1.
 *
 * No capability is checked **on purpose**: `API.md` §8.3 lists SET-1 among the
 * seven session-only endpoints ("all · authenticated — company data appears on
 * every screen header and every PDF"), and `ARCHITECTURE.md` §6.2 has no
 * company-read row to check. The session guard (`requireRequestSession` +
 * `PASSWORD_CHANGE_REQUIRED`) is the whole access rule; a `403` here would be an
 * invented rule (`AGENTS.md` §6).
 */
export async function getCompany(): Promise<CompanyDto> {
  const row = await repo.findCompany(db());
  // First run: the UI shows the setup empty state (PRD §12, API.md SET-1).
  if (!row) throw new AppError("COMPANY_NOT_CONFIGURED");
  return toCompanyDto(row);
}

// ---------------------------------------------------------------------------
// Projects — `API.md` §3.2 SET-3, SET-5
// ---------------------------------------------------------------------------

/**
 * `GET /api/projects` — SET-3. `inventory.read` (all three roles), then the
 * company-scoped page. The singleton company is resolved first so the query can
 * use `ix_project_company_active` — the index `API.md` names for this endpoint.
 */
export async function listProjects(
  actor: Actor,
  query: ListProjectsQuery,
): Promise<PageDto<ProjectDto>> {
  requireCapability(actor, "inventory.read");
  const client = db();
  const company = await repo.findCompany(client);
  // SET-3 documents exactly one response: `200 Page<Project>`. Before the
  // singleton exists there are no projects, so the honest answer is an empty
  // page — not SET-4's `404 COMPANY_NOT_CONFIGURED` (which `API.md` §5.4 scopes
  // to SET-1/SET-4 only). See AG-Q19.
  if (!company) {
    return { data: [], page: query.page, pageSize: query.pageSize, total: 0 };
  }

  const order = query.order ?? (query.sort === "createdAt" ? "desc" : "asc");
  const { data, total } = await repo.listProjects(client, {
    companyId: company.id,
    isActive: query.isActive,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    order,
  });
  return {
    data: data.map(toProjectDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** `GET /api/projects/{id}` — SET-5, `inventory.read`. */
export async function getProject(
  actor: Actor,
  id: string,
): Promise<ProjectDto> {
  requireCapability(actor, "inventory.read");
  const row = await repo.findProjectById(db(), id);
  if (!row) throw new AppError("PROJECT_NOT_FOUND");
  return toProjectDto(row);
}
