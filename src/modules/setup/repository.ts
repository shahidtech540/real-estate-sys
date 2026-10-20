import type { Decimal } from "decimal.js";
import type { Db } from "@/core/db";

/**
 * The only file in the Setup module that talks to Prisma
 * (`ARCHITECTURE.md` §4.4 rule 4, `AGENTS.md` §5.9). It owns `company`
 * (`DATABASE.md` §3.2) and never opens a transaction — the command passes its
 * `Tx` down (`AGENTS.md` §5.7).
 */

export interface CompanyRecord {
  id: string;
  name: string;
  logoFileId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: Decimal;
  createdAt: Date;
  updatedAt: Date;
}

const companySelection = {
  id: true,
  name: true,
  logoFileId: true,
  address: true,
  phone: true,
  email: true,
  pdfTermsText: true,
  marlaSqft: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The singleton is read with `findFirst`: `uq_company_singleton` is an
 * expression index on `((true))`, so Prisma has no unique selector to offer
 * (`DATABASE.md` §6.2). Zero rows is a valid, documented state (SET-1's
 * `COMPANY_NOT_CONFIGURED`).
 */
export async function findCompany(client: Db): Promise<CompanyRecord | null> {
  return (await client.company.findFirst({
    select: companySelection,
  })) as CompanyRecord | null;
}

export interface CompanyWriteData {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  /** A decimal string; Prisma accepts it directly for `numeric(10,2)`. */
  marlaSqft: string;
  logoFileId: string | null;
}

export async function insertCompany(
  client: Db,
  data: CompanyWriteData,
): Promise<CompanyRecord> {
  return (await client.company.create({
    data,
    select: companySelection,
  })) as CompanyRecord;
}

export async function updateCompany(
  client: Db,
  id: string,
  data: CompanyWriteData,
): Promise<CompanyRecord> {
  return (await client.company.update({
    where: { id },
    data,
    select: companySelection,
  })) as CompanyRecord;
}

// ---------------------------------------------------------------------------
// project — DATABASE.md §3.2
// ---------------------------------------------------------------------------

export interface ProjectRecord {
  id: string;
  companyId: string;
  name: string;
  location: string | null;
  marlaSqft: Decimal | null;
  masterPlanFileId: string | null;
  masterPlanWidthPx: number | null;
  masterPlanHeightPx: number | null;
  masterPlanUploadedAt: Date | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const projectSelection = {
  id: true,
  companyId: true,
  name: true,
  location: true,
  marlaSqft: true,
  masterPlanFileId: true,
  masterPlanWidthPx: true,
  masterPlanHeightPx: true,
  masterPlanUploadedAt: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function findProjectById(
  client: Db,
  id: string,
): Promise<ProjectRecord | null> {
  return (await client.project.findUnique({
    where: { id },
    select: projectSelection,
  })) as ProjectRecord | null;
}

export interface ProjectListFilters {
  companyId: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
  sort: "name" | "createdAt";
  order: "asc" | "desc";
}

/** `ix_project_company_active` serves both the filter and the count. */
export async function listProjects(
  client: Db,
  filters: ProjectListFilters,
): Promise<{ data: ProjectRecord[]; total: number }> {
  const where = {
    companyId: filters.companyId,
    ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
  };
  const [data, total] = await Promise.all([
    client.project.findMany({
      where,
      select: projectSelection,
      // `id` breaks ties so equal names/instants keep a stable page order.
      orderBy: [{ [filters.sort]: filters.order }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }) as Promise<ProjectRecord[]>,
    client.project.count({ where }),
  ]);
  return { data, total };
}

export interface ProjectWriteData {
  companyId: string;
  name: string;
  location: string | null;
  marlaSqft: string | null;
}

export async function insertProject(
  client: Db,
  data: ProjectWriteData,
): Promise<ProjectRecord> {
  return (await client.project.create({
    data,
    select: projectSelection,
  })) as ProjectRecord;
}

export interface ProjectPatchData {
  name?: string;
  location?: string | null;
  marlaSqft?: string | null;
  isActive?: boolean;
}

/**
 * The compare-and-swap of `DATABASE.md` §1.7: `WHERE id = $1 AND version = $2`,
 * `version = version + 1`. `updateMany` is the only Prisma call that returns a
 * row count without throwing, and the `WHERE … version` is what makes two
 * concurrent PATCHes unable to both succeed — there is **no** read-then-compare
 * here, by design (`API.md` §1.6).
 */
export async function patchProject(
  client: Db,
  id: string,
  version: number,
  data: ProjectPatchData,
): Promise<number> {
  const result = await client.project.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
  return result.count;
}

export interface MasterPlanWriteData {
  masterPlanFileId: string;
  masterPlanWidthPx: number | null;
  masterPlanHeightPx: number | null;
  masterPlanUploadedAt: Date;
}

/** SET-7's CAS: the same conditional-update shape as `patchProject`. */
export async function replaceMasterPlan(
  client: Db,
  id: string,
  version: number,
  data: MasterPlanWriteData,
): Promise<number> {
  const result = await client.project.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
  return result.count;
}
