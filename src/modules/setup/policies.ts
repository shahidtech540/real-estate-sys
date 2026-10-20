import { isPositive, toWireAmount, type DecimalInput } from "@/core/money";
import { unprocessable } from "@/core/errors";

/**
 * Setup business invariants that are not permissions
 * (`ARCHITECTURE.md` §4.1 module anatomy: `policies.ts`).
 *
 * Pure functions only: no database, no request, no clock — so the rules are
 * unit-tested directly (`AGENTS.md` §7.2).
 */

/**
 * `V-19` / `API.md` SET-2: `marlaSqft` must be strictly positive. The shape was
 * already validated (any well-formed decimal parses), so a zero or negative
 * value is `422 VALIDATION_FAILED` and names the field — the same rule
 * `ck_company_marla` enforces in the database (`DATABASE.md` §3.2, §6.3).
 */
export function assertPositiveMarla(marlaSqft: string): void {
  if (!isPositive(marlaSqft)) {
    throw unprocessable({ marlaSqft: "TOO_SMALL" });
  }
}

/** The full-replace value set of `PUT /api/company` (`API.md` SET-2). */
export interface CompanyValues {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: string;
  logoFileId: string | null;
}

/** The stored side of a comparison; `marlaSqft` is a Prisma `Decimal`. */
export interface CompanySnapshot {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  pdfTermsText: string | null;
  marlaSqft: DecimalInput;
  logoFileId: string | null;
}

/** Field order is the SET-2 body order, so the audit summary is stable. */
const COMPANY_FIELDS = [
  "name",
  "address",
  "phone",
  "email",
  "pdfTermsText",
  "marlaSqft",
  "logoFileId",
] as const;

/**
 * The `fields` list of a `company.updated` audit summary — **names only**
 * (`ARCHITECTURE.md` §13.2: no contact details, no file paths). Passing `null`
 * as `previous` describes a first create and lists every non-empty field.
 */
export function changedCompanyFields(
  previous: CompanySnapshot | null,
  next: CompanyValues,
): string[] {
  const normalize = (values: CompanyValues | CompanySnapshot): string[] => [
    values.name,
    values.address ?? "",
    values.phone ?? "",
    values.email ?? "",
    values.pdfTermsText ?? "",
    toWireAmount(values.marlaSqft),
    values.logoFileId ?? "",
  ];

  const before = previous ? normalize(previous) : null;
  const after = normalize(next);
  return COMPANY_FIELDS.filter((_, index) =>
    before ? before[index] !== after[index] : after[index] !== "",
  );
}

/**
 * `ARCHITECTURE.md` §7.5 (via `API.md` SET-2): the previous logo object is
 * soft-deleted **only when nothing else references it**. A replacement that
 * re-uses the same object, or an object still referenced by another row, stays
 * live.
 */
export function shouldSoftDeleteLogo(
  previousLogoFileId: string | null,
  nextLogoFileId: string | null,
  referenceCount: number,
): boolean {
  if (!previousLogoFileId) return false;
  if (previousLogoFileId === nextLogoFileId) return false;
  return referenceCount === 0;
}
