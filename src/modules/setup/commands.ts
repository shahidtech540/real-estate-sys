import { db, isUniqueViolation, type Tx } from "@/core/db";
import { AppError } from "@/core/errors";
import { requireCapability } from "@/core/authz/policy";
import { toWireAmount } from "@/core/money";
import { record } from "@/modules/audit/record";
import {
  countFileReferences,
  findFileForBinding,
  softDeleteFile,
} from "@/modules/core/files";
import type { Actor, RequestMeta } from "@/modules/identity";
import {
  toCompanyDto,
  toProjectDto,
  type CompanyDto,
  type ProjectDto,
} from "./dto";
import {
  assertPositiveMarla,
  changedCompanyFields,
  changedProjectFields,
  planAspectRatioChanged,
  shouldSoftDeleteLogo,
  type CompanyValues,
} from "./policies";
import * as repo from "./repository";
import type {
  CompanyBody,
  CreateProjectBody,
  MasterPlanBody,
  UpdateProjectBody,
} from "./schemas";

/**
 * `PUT /api/company` — `API.md` §3.2 SET-2.
 *
 * Sequence fixed by the documents:
 * 1. `setup.manage` **before any row lookup** (`ARCHITECTURE.md` §6.3).
 * 2. Shape is already parsed (`schemas.ts`); positivity is `422` (`V-19`).
 * 3. Logo is bound by `file_object.id`, never a storage path (`API.md` V-14,
 *    `ARCHITECTURE.md` §7.2).
 * 4. Company write + its `company.created`/`company.updated` audit row share one
 *    transaction (`ARCHITECTURE.md` §13.1). The replaced logo is soft-deleted
 *    only when no row references it (§7.5).
 * 5. `uq_company_singleton` makes a second row impossible; the loser of a
 *    concurrent first-run PUT retries as an update (`API.md` SET-2 notes).
 */

export interface PutCompanyResult {
  company: CompanyDto;
  created: boolean;
}

export async function putCompany(
  actor: Actor,
  input: CompanyBody,
  meta: RequestMeta,
): Promise<PutCompanyResult> {
  // Admin only, checked inside the command (`AGENTS.md` §5.3).
  requireCapability(actor, "setup.manage");
  // `422 VALIDATION_FAILED` — not a Zod failure, so it cannot be a 400.
  assertPositiveMarla(input.marlaSqft);

  // Full replace: every column is written; omitted optional text is null
  // (API.md SET-2 notes). Decimal strings are normalized to two decimals.
  const values: CompanyValues = {
    name: input.name,
    address: input.address,
    phone: input.phone,
    email: input.email,
    pdfTermsText: input.pdfTermsText,
    marlaSqft: toWireAmount(input.marlaSqft),
    logoFileId: input.logoFileId,
  };

  const client = db();
  const now = new Date();

  // First attempt creates or updates; a concurrent first-run loser retries once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await client.$transaction((tx: Tx) =>
        writeCompany(tx, actor, values, meta, now),
      );
    } catch (error) {
      if (!isSingletonConflict(error)) throw error;
      // The other request committed the singleton between our read and insert.
      // Retry — the row now exists, so the same function takes the update path
      // and returns 200 (`API.md` SET-2 notes; IMPLEMENTATION-PLAN.md §2.8).
    }
  }

  // Two consecutive singleton conflicts cannot happen once the row exists;
  // treat it as the retryable conflict rather than a 500 with no explanation.
  throw new AppError("CONFLICT_RETRY");
}

async function writeCompany(
  tx: Tx,
  actor: Actor,
  values: CompanyValues,
  meta: RequestMeta,
  now: Date,
): Promise<PutCompanyResult> {
  const logoFileId = await resolveLogoId(tx, values.logoFileId);
  const data: CompanyValues = { ...values, logoFileId };

  const existing = await repo.findCompany(tx);

  if (existing) {
    const updated = await repo.updateCompany(tx, existing.id, data);
    await releaseReplacedLogo(tx, existing.logoFileId, logoFileId, now);
    await record(tx, {
      action: "company.updated",
      entityType: "company",
      entityId: updated.id,
      actor: { id: actor.id, label: actor.name },
      requestId: meta.requestId,
      ip: meta.ip,
      // Field names only — never the company's contact details
      // (`ARCHITECTURE.md` §13.2, AGENTS.md §5.10).
      summary: { fields: changedCompanyFields(existing, data) },
    });
    return { company: toCompanyDto(updated), created: false };
  }

  const created = await repo.insertCompany(tx, data);
  await record(tx, {
    action: "company.created",
    entityType: "company",
    entityId: created.id,
    actor: { id: actor.id, label: actor.name },
    requestId: meta.requestId,
    ip: meta.ip,
    summary: { fields: changedCompanyFields(null, data) },
  });
  return { company: toCompanyDto(created), created: true };
}

/**
 * `V-14` (`API.md` §4): a referenced file must exist, not be soft-deleted, and
 * carry the kind the binding expects. An unknown/deleted id is `404`, a live
 * object of another kind is `422`. Only the id is used — the storage key never
 * reaches this module (`ARCHITECTURE.md` §7.2).
 */
async function resolveLogoId(
  tx: Tx,
  logoFileId: string | null,
): Promise<string | null> {
  if (!logoFileId) return null;
  const file = await findFileForBinding(tx, logoFileId);
  if (!file || file.deletedAt) throw new AppError("FILE_NOT_FOUND");
  if (file.kind !== "COMPANY_LOGO") throw new AppError("FILE_KIND_MISMATCH");
  return file.id;
}

/**
 * `ARCHITECTURE.md` §7.5: the previous object is soft-deleted only when nothing
 * else references it. Runs after the company row already points at the new
 * object, inside the same transaction, so a rollback restores both.
 */
async function releaseReplacedLogo(
  tx: Tx,
  previousLogoFileId: string | null,
  nextLogoFileId: string | null,
  now: Date,
): Promise<void> {
  if (!previousLogoFileId) return;
  const references = await countFileReferences(tx, previousLogoFileId);
  if (shouldSoftDeleteLogo(previousLogoFileId, nextLogoFileId, references)) {
    await softDeleteFile(tx, previousLogoFileId, now);
  }
}

/**
 * `uq_company_singleton` is an expression index (`DATABASE.md` §6.2) that
 * `schema.prisma` cannot declare, so Prisma may report its 23505 either as
 * `P2002` or as an unnamed "Unique constraint failed" error. Both mean the
 * singleton appeared while this request was inserting.
 */
function isSingletonConflict(error: unknown): boolean {
  if (isUniqueViolation(error)) return true;
  if (!(error instanceof Error)) return false;
  // The raw driver message ("duplicate key value violates unique constraint
  // \"uq_company_singleton\"") or the bare SQLSTATE, if the engine could not map
  // the expression index to a model target.
  return (
    /unique constraint/i.test(error.message) || /23505/.test(error.message)
  );
}

// ---------------------------------------------------------------------------
// Projects — `API.md` §3.2 SET-4, SET-6, SET-7
// ---------------------------------------------------------------------------

/**
 * `POST /api/projects` — SET-4.
 *
 * Order: capability (`setup.manage`) → `marlaSqft` positivity (`422`) → company
 * exists (`404 COMPANY_NOT_CONFIGURED`) → insert + `project.created` in one
 * transaction. `companyId` is the singleton, never the body (`API.md` SET-4
 * "derived, never sent"). A `marlaSqft` of `null` is replaced with the
 * company's current value **at creation time** (`PRD` D-1): the row stores a
 * real number, so a later company change cannot retroactively move the project.
 */
export async function createProject(
  actor: Actor,
  input: CreateProjectBody,
  meta: RequestMeta,
): Promise<ProjectDto> {
  requireCapability(actor, "setup.manage");
  if (input.marlaSqft !== null) assertPositiveMarla(input.marlaSqft);

  try {
    return await db().$transaction(async (tx: Tx) => {
      const company = await repo.findCompany(tx);
      if (!company) throw new AppError("COMPANY_NOT_CONFIGURED");

      const marlaSqft =
        input.marlaSqft === null
          ? toWireAmount(company.marlaSqft)
          : toWireAmount(input.marlaSqft);

      const created = await repo.insertProject(tx, {
        companyId: company.id,
        name: input.name,
        location: input.location,
        marlaSqft,
      });
      await record(tx, {
        action: "project.created",
        entityType: "project",
        entityId: created.id,
        actor: { id: actor.id, label: actor.name },
        requestId: meta.requestId,
        ip: meta.ip,
        // Ids and field names only (`ARCHITECTURE.md` §13.2).
        summary: {
          companyId: company.id,
          fields: ["name", "location", "marlaSqft"],
        },
      });
      return toProjectDto(created);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("PROJECT_NAME_EXISTS", { fields: { name: "EXISTS" } });
    }
    throw error;
  }
}

/**
 * `PATCH /api/projects/{id}` — SET-6.
 *
 * The update **is** the compare-and-swap (`DATABASE.md` §1.7, `API.md` §1.6):
 * `UPDATE … WHERE id = $1 AND version = $2`. The `WHERE` clause is the source
 * of truth — two concurrent PATCHes both send the version they loaded, so at
 * most one UPDATE can match and the other gets `409`, with no lost update.
 *
 * The row is loaded before the update for two things the CAS cannot provide:
 * answering `404 PROJECT_NOT_FOUND` for an unknown id, and diffing the fields
 * for the audit summary. That read never decides whether the write succeeds —
 * `matched === 0` is always `409`, even though the row was just read
 * successfully — so it cannot reintroduce a read-then-compare race.
 */
export async function updateProject(
  actor: Actor,
  id: string,
  input: UpdateProjectBody,
  meta: RequestMeta,
): Promise<ProjectDto> {
  requireCapability(actor, "setup.manage");
  if (input.marlaSqft !== undefined && input.marlaSqft !== null) {
    assertPositiveMarla(input.marlaSqft);
  }
  if (input.name !== undefined) {
    // The schema already rejects blank names; this keeps the intent explicit.
    if (input.name.trim() === "") {
      throw new AppError("VALIDATION_FAILED", { fields: { name: "REQUIRED" } });
    }
  }

  const data: repo.ProjectPatchData = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.location !== undefined) data.location = input.location;
  if (input.marlaSqft !== undefined) {
    data.marlaSqft =
      input.marlaSqft === null ? null : toWireAmount(input.marlaSqft);
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  try {
    return await db().$transaction(async (tx: Tx) => {
      const previous = await repo.findProjectById(tx, id);
      if (!previous) throw new AppError("PROJECT_NOT_FOUND");

      const changed = changedProjectFields(previous, {
        name: data.name,
        location: data.location,
        marlaSqft: data.marlaSqft,
        isActive: data.isActive,
      });

      // The CAS. Even an all-optional body advances the counter, so every
      // successful PATCH moves the row forward and a stale token is always
      // detectable; `fields` stays empty when nothing actually changed.
      const matched = await repo.patchProject(tx, id, input.version, data);
      if (matched === 0) {
        throw new AppError("CONFLICT_STALE_WRITE", {
          fields: { version: "STALE" },
        });
      }

      const updated = await repo.findProjectById(tx, id);
      if (!updated) {
        // The row cannot vanish: `project` is never hard-deleted
        // (`DATABASE.md` §1.6). Treat it as the documented stale conflict.
        throw new AppError("CONFLICT_STALE_WRITE", {
          fields: { version: "STALE" },
        });
      }

      if (changed.length > 0) {
        await record(tx, {
          action: "project.updated",
          entityType: "project",
          entityId: updated.id,
          actor: { id: actor.id, label: actor.name },
          requestId: meta.requestId,
          ip: meta.ip,
          // Field **names** only; no project name, location or amount.
          summary: { fields: changed },
        });
      }
      return toProjectDto(updated);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("PROJECT_NAME_EXISTS", { fields: { name: "EXISTS" } });
    }
    throw error;
  }
}

/**
 * `PUT /api/projects/{id}/master-plan` — SET-7.
 *
 * **Capability is `inventory.manage`, not `setup.manage`** — `API.md` SET-7's
 * roles line is literal, and `ARCHITECTURE.md` §6.2 puts the master plan under
 * `inventory.manage` even though `project` is the Setup module's table. The
 * binding is an inventory concern; the table ownership is unchanged.
 *
 * The transaction:
 * 1. read the project (needed for the stored aspect ratio and its dimensions);
 * 2. `V-14` file check: exists, not soft-deleted, kind `MASTER_PLAN`;
 * 3. `V-12` aspect guard unless confirmed or first upload;
 * 4. CAS on `version` — zero rows is `409 CONFLICT_STALE_WRITE`;
 * 5. audit `project.master_plan_replaced`, ids and field names only.
 *
 * **The previous master plan is never deleted** (`ARCHITECTURE.md` §7.5: "all
 * versions are retained"). This deliberately does **not** call
 * `countFileReferences`/`softDeleteFile` — that pair belongs to SET-2's logo
 * lifecycle, where a replaced object is soft-deleted when unreferenced.
 */
export async function replaceProjectMasterPlan(
  actor: Actor,
  id: string,
  input: MasterPlanBody,
  meta: RequestMeta,
): Promise<ProjectDto> {
  requireCapability(actor, "inventory.manage");

  return await db().$transaction(async (tx: Tx) => {
    const previous = await repo.findProjectById(tx, id);
    if (!previous) throw new AppError("PROJECT_NOT_FOUND");

    const file = await findFileForBinding(tx, input.fileId);
    if (!file || file.deletedAt) throw new AppError("FILE_NOT_FOUND");
    if (file.kind !== "MASTER_PLAN") throw new AppError("FILE_KIND_MISMATCH");

    const priorDimensions =
      previous.masterPlanWidthPx !== null &&
      previous.masterPlanHeightPx !== null
        ? {
            widthPx: previous.masterPlanWidthPx,
            heightPx: previous.masterPlanHeightPx,
          }
        : null;
    const nextDimensions =
      file.widthPx !== null && file.heightPx !== null
        ? { widthPx: file.widthPx, heightPx: file.heightPx }
        : null;

    if (
      planAspectRatioChanged(
        priorDimensions,
        nextDimensions,
        input.confirmAspectRatioChange,
      )
    ) {
      throw new AppError("MASTER_PLAN_ASPECT_CHANGED", {
        fields: { fileId: "ASPECT_CHANGED" },
      });
    }

    const matched = await repo.replaceMasterPlan(tx, id, input.version, {
      masterPlanFileId: file.id,
      masterPlanWidthPx: file.widthPx,
      masterPlanHeightPx: file.heightPx,
      masterPlanUploadedAt: new Date(),
    });
    if (matched === 0) {
      throw new AppError("CONFLICT_STALE_WRITE", {
        fields: { version: "STALE" },
      });
    }

    const updated = await repo.findProjectById(tx, id);
    if (!updated) throw new AppError("PROJECT_NOT_FOUND");

    await record(tx, {
      action: "project.master_plan_replaced",
      entityType: "project",
      entityId: updated.id,
      actor: { id: actor.id, label: actor.name },
      requestId: meta.requestId,
      ip: meta.ip,
      summary: {
        previousFileId: previous.masterPlanFileId,
        fileId: file.id,
        fields: ["masterPlanFileId", "masterPlanWidthPx", "masterPlanHeightPx"],
      },
    });
    return toProjectDto(updated);
  });
}
