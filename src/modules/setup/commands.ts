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
import { toCompanyDto, type CompanyDto } from "./dto";
import {
  assertPositiveMarla,
  changedCompanyFields,
  shouldSoftDeleteLogo,
  type CompanyValues,
} from "./policies";
import * as repo from "./repository";
import type { CompanyBody } from "./schemas";

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
