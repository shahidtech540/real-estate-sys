import { toWireAmount } from "@/core/money";
import type { CompanyRecord, ProjectRecord } from "./repository";

/**
 * The only place a `company` row becomes a wire object — `AGENTS.md` §5.4
 * ("a DTO mapper is the only place that converts Prisma `Decimal`/`Date`").
 *
 * Shape is `API.md` §1.9 `Company`, exactly: `logo` is a `FileRef`
 * (`{id, url}` with `url = /api/files/{id}`) built from `logo_file_id`, never a
 * storage key. There is no `createdAt` and no `marlaSqft` number.
 */
export interface CompanyFileRefDto {
  id: string;
  url: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: string;
  logo: CompanyFileRefDto | null;
  updatedAt: string;
}

export function toCompanyDto(row: CompanyRecord): CompanyDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    pdfTermsText: row.pdfTermsText,
    marlaSqft: toWireAmount(row.marlaSqft),
    logo: row.logoFileId
      ? { id: row.logoFileId, url: `/api/files/${row.logoFileId}` }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Projects — `API.md` §1.9 `Project`, SET-3 … SET-7
// ---------------------------------------------------------------------------

/**
 * `API.md` §1.9:
 *
 * ```ts
 * interface Project {
 *   id: UUID; name: string; location: string | null;
 *   marlaSqft: DecimalString | null;
 *   isActive: boolean; version: number;
 *   masterPlan: MasterPlanRef | null;      // (derived) from project.master_plan_* columns
 *   createdAt: Instant; updatedAt: Instant;
 * }
 * ```
 *
 * `companyId` is internal (`DATABASE.md` §3.2: the singleton is implied), and
 * `masterPlan` is the documented derived object — the four stored columns
 * projected, never a copy of `file_object`.
 */
export interface ProjectMasterPlanDto {
  fileId: string;
  url: string;
  widthPx: number;
  heightPx: number;
  uploadedAt: string | null;
}

export interface ProjectDto {
  id: string;
  name: string;
  location: string | null;
  marlaSqft: string | null;
  isActive: boolean;
  version: number;
  masterPlan: ProjectMasterPlanDto | null;
  createdAt: string;
  updatedAt: string;
}

export function toProjectDto(row: ProjectRecord): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    // `null` keeps meaning "inherit `company.marla_sqft`" (PRD D-1) — but only
    // for rows created before the inheritance rule; SET-4 stores the inherited
    // value on the row, so a live project always carries its own number.
    marlaSqft: row.marlaSqft === null ? null : toWireAmount(row.marlaSqft),
    isActive: row.isActive,
    version: row.version,
    masterPlan: toMasterPlanDto(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `MasterPlanRef` (`API.md` §1.9). `ck_project_plan_dims` guarantees both
 * dimensions are null or both positive (`DATABASE.md` §3.2), so a row with a
 * plan id but no dimensions cannot exist.
 */
export function toMasterPlanDto(
  row: ProjectRecord,
): ProjectMasterPlanDto | null {
  if (!row.masterPlanFileId) return null;
  if (row.masterPlanWidthPx === null || row.masterPlanHeightPx === null) {
    // `ck_project_plan_dims` only says "both null or both positive"; it does not
    // forbid a plan id with no dimensions. Every application write supplies the
    // pair — COR-1 decodes the image (`ARCHITECTURE.md` §7.3 step 5) and SET-7
    // stores it — so this means an out-of-band row. Failing loudly beats
    // reporting a fabricated `0` as a real dimension.
    throw new Error(
      `project ${row.id} references a master plan without stored dimensions`,
    );
  }
  return {
    fileId: row.masterPlanFileId,
    url: `/api/files/${row.masterPlanFileId}`,
    widthPx: row.masterPlanWidthPx,
    heightPx: row.masterPlanHeightPx,
    uploadedAt: row.masterPlanUploadedAt?.toISOString() ?? null,
  };
}
